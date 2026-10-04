"""The screen stream: one WebRTC peer connection per open stream.

The VM makes the offer. ``ScreenTrack`` turns frames from a ``FrameSource``
into video; the ``input`` data channel carries user input back. Input
reaches the desktop only while the gate says the user may drive it
(control taken, or a handoff in progress). Video flows whenever a stream
is open.
"""

from __future__ import annotations

import asyncio
import fractions
import io
import json
import logging
import shutil
import time
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

import av
from aiortc import (
    MediaStreamTrack,
    RTCConfiguration,
    RTCDataChannel,
    RTCIceCandidate,
    RTCIceServer,
    RTCPeerConnection,
    RTCSessionDescription,
)
from aiortc.sdp import candidate_from_sdp

from apparatus_protocol import INPUT_CHANNEL, InputKind

from .desktop import DesktopBackend

log = logging.getLogger("agentd.stream")
CLOCK = 90_000  # the RTP video clock
SignalSend = Callable[[str, dict[str, Any]], Awaitable[None]]
Gate = Callable[[str], bool]


class FrameSource(Protocol):
    width: int
    height: int

    async def start(self) -> None: ...
    async def frame(self) -> av.VideoFrame:
        """The next frame, paced at the source's rate."""
        ...

    async def stop(self) -> None: ...


def rgb_frame(width: int, height: int, data: bytes) -> av.VideoFrame:
    """An rgb24 ``VideoFrame`` from packed bytes, with the plane's own stride."""
    frame = av.VideoFrame(width, height, "rgb24")
    plane = frame.planes[0]
    row = width * 3
    if plane.line_size == row:
        plane.update(data)
    else:
        pad = b"\0" * (plane.line_size - row)
        plane.update(b"".join(data[i * row : (i + 1) * row] + pad for i in range(height)))
    return frame


class X11FrameSource:
    """ffmpeg x11grab -> rawvideo rgb24 on a pipe."""

    def __init__(self, display: str, fps: int, width: int, height: int):
        self.display = display
        self.fps = fps
        self.width = width
        self.height = height
        self.proc: asyncio.subprocess.Process | None = None
        if shutil.which("ffmpeg") is None:
            raise RuntimeError("ffmpeg is not installed")

    def argv(self) -> list[str]:
        return [
            "ffmpeg",
            "-loglevel",
            "error",
            "-nostdin",
            "-f",
            "x11grab",
            "-framerate",
            str(self.fps),
            "-video_size",
            f"{self.width}x{self.height}",
            "-draw_mouse",
            "1",
            "-i",
            self.display,
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ]

    async def start(self) -> None:
        if self.proc is not None:
            return
        self.proc = await asyncio.create_subprocess_exec(
            *self.argv(),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

    async def frame(self) -> av.VideoFrame:
        if self.proc is None or self.proc.stdout is None:
            raise RuntimeError("frame source not started")
        try:
            data = await self.proc.stdout.readexactly(self.width * self.height * 3)
        except asyncio.IncompleteReadError:
            err = b""
            if self.proc.stderr is not None:
                err = await self.proc.stderr.read()
            raise RuntimeError(f"ffmpeg ended: {err.decode(errors='replace').strip()}") from None
        return rgb_frame(self.width, self.height, data)

    async def stop(self) -> None:
        proc, self.proc = self.proc, None
        if proc is None or proc.returncode is not None:
            return
        proc.terminate()
        try:
            await asyncio.wait_for(proc.wait(), timeout=3)
        except TimeoutError:
            proc.kill()
            await proc.wait()


class FakeFrameSource:
    """Frames from the backend's screenshot, or a solid colour. For tests and the fake desktop."""

    def __init__(
        self,
        fps: int = 12,
        width: int = 160,
        height: int = 120,
        backend: DesktopBackend | None = None,
        colour: tuple[int, int, int] = (32, 96, 160),
    ):
        self.fps = fps
        self.width = width
        self.height = height
        self.backend = backend
        self.colour = colour
        self.frames = 0

    async def start(self) -> None:
        self.frames = 0

    async def frame(self) -> av.VideoFrame:
        await asyncio.sleep(1 / self.fps)
        self.frames += 1
        if self.backend is not None:
            png = await self.backend.screenshot()
            with av.open(io.BytesIO(png), format="png_pipe") as container:
                decoded = next(container.decode(video=0))
            return decoded.reformat(width=self.width, height=self.height, format="rgb24")
        return rgb_frame(self.width, self.height, bytes(self.colour) * (self.width * self.height))

    async def stop(self) -> None:
        pass


class ScreenTrack(MediaStreamTrack):
    """A video track that pulls frames from a ``FrameSource``."""

    kind = "video"

    def __init__(self, source: FrameSource):
        super().__init__()
        self.source = source
        self._started_at: float | None = None

    async def recv(self) -> av.VideoFrame:
        if self.readyState != "live":
            raise RuntimeError("track ended")
        frame = await self.source.frame()
        now = time.monotonic()
        if self._started_at is None:
            self._started_at = now
        frame.pts = int((now - self._started_at) * CLOCK)
        frame.time_base = fractions.Fraction(1, CLOCK)
        return frame

    def stop(self) -> None:
        super().stop()


class Stream:
    def __init__(self, stream_id: str, pc: RTCPeerConnection, source: FrameSource):
        self.stream_id = stream_id
        self.pc = pc
        self.source = source
        self.channel: RTCDataChannel | None = None
        self.track: ScreenTrack | None = None


class StreamManager:
    """Open streams by id. ``gate(stream_id)`` says whether input from that stream may reach the desktop."""

    def __init__(
        self,
        backend: DesktopBackend,
        source_factory: Callable[[], FrameSource],
        send_signal: SignalSend,
        gate: Gate,
    ):
        self.backend = backend
        self.source_factory = source_factory
        self.send_signal = send_signal
        self.gate = gate
        self.streams: dict[str, Stream] = {}
        self.dropped = 0  # input events refused by the gate

    @property
    def stream_ids(self) -> list[str]:
        return list(self.streams)

    async def start(self, stream_id: str, ice_servers: list[dict[str, Any]]) -> None:
        if stream_id in self.streams:
            return
        source = self.source_factory()
        await source.start()
        pc = RTCPeerConnection(RTCConfiguration(iceServers=_ice_servers(ice_servers)))
        st = Stream(stream_id, pc, source)
        self.streams[stream_id] = st
        st.track = ScreenTrack(source)
        pc.addTrack(st.track)
        st.channel = pc.createDataChannel(INPUT_CHANNEL)
        self._wire_channel(stream_id, st.channel)

        @pc.on("connectionstatechange")
        async def on_state() -> None:
            if pc.connectionState in ("failed", "closed") and self.streams.get(stream_id) is st:
                await self.stop(stream_id)

        try:
            await pc.setLocalDescription(await pc.createOffer())
        except Exception:
            await self.stop(stream_id)
            raise
        desc = pc.localDescription
        await self.send_signal(stream_id, {"description": {"type": desc.type, "sdp": desc.sdp}})

    async def signal(self, stream_id: str, payload: dict[str, Any]) -> None:
        st = self.streams.get(stream_id)
        if st is None:
            log.info("signal for unknown stream %s dropped", stream_id)
            return
        description = payload.get("description")
        candidate = payload.get("candidate")
        if isinstance(description, dict):
            await st.pc.setRemoteDescription(
                RTCSessionDescription(sdp=str(description["sdp"]), type=str(description["type"]))
            )
        elif isinstance(candidate, dict):
            cand = _ice_candidate(candidate)
            await st.pc.addIceCandidate(cand)

    async def stop(self, stream_id: str) -> None:
        st = self.streams.pop(stream_id, None)
        if st is None:
            return
        if st.track is not None:
            st.track.stop()
        await st.pc.close()
        await st.source.stop()

    async def stop_all(self) -> None:
        for stream_id in list(self.streams):
            await self.stop(stream_id)

    # ---------------------------------------------------------------- #
    # input
    # ---------------------------------------------------------------- #

    def _wire_channel(self, stream_id: str, channel: RTCDataChannel) -> None:
        @channel.on("message")
        async def on_message(raw: Any) -> None:
            await self.on_input(stream_id, raw)

    async def on_input(self, stream_id: str, raw: Any) -> None:
        try:
            ev = json.loads(raw)
        except (TypeError, ValueError):
            return
        if not isinstance(ev, dict) or ev.get("kind") not in InputKind.ALL:
            return
        if not self.gate(stream_id):
            self.dropped += 1
            return
        try:
            await self.backend.input_event(ev)
        except Exception as e:  # noqa: BLE001 - one bad key must not end the stream
            log.warning("input %s failed: %s", ev.get("kind"), e)


def _ice_servers(raw: list[dict[str, Any]]) -> list[RTCIceServer]:
    out = []
    for s in raw:
        urls = s.get("urls")
        if not urls:
            continue
        out.append(
            RTCIceServer(urls=urls, username=s.get("username"), credential=s.get("credential"))
        )
    return out


def _ice_candidate(c: dict[str, Any]) -> RTCIceCandidate | None:
    """An aiortc candidate from the browser's ``RTCIceCandidateInit``. Empty means end."""
    line = str(c.get("candidate") or "")
    if not line:
        return None
    if line.startswith("candidate:"):
        line = line[len("candidate:") :]
    cand = candidate_from_sdp(line)
    cand.sdpMid = c.get("sdpMid")
    idx = c.get("sdpMLineIndex")
    cand.sdpMLineIndex = int(idx) if idx is not None else None
    return cand
