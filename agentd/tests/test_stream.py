"""The screen stream in-process: agentd offers, a second peer answers, frames and input cross."""

import asyncio
import json

import pytest
from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription

from agentd.desktop import FakeBackend, input_argv, keysym
from agentd.stream import FakeFrameSource, ScreenTrack, StreamManager, X11FrameSource, rgb_frame


class Peer:
    """The client side of one loopback stream: answers, reads video, sends input."""

    def __init__(self):
        self.pc = RTCPeerConnection(RTCConfiguration(iceServers=[]))
        self.frame = asyncio.get_running_loop().create_future()
        self.channel = asyncio.get_running_loop().create_future()
        self.pc.on("track")(self._on_track)
        self.pc.on("datachannel")(self._on_channel)

    def _on_track(self, track):
        async def read():
            f = await track.recv()
            if not self.frame.done():
                self.frame.set_result(f)

        asyncio.ensure_future(read())

    def _on_channel(self, channel):
        if not self.channel.done():
            self.channel.set_result(channel)

    async def answer(self, offer: dict) -> dict:
        await self.pc.setRemoteDescription(RTCSessionDescription(offer["sdp"], offer["type"]))
        await self.pc.setLocalDescription(await self.pc.createAnswer())
        d = self.pc.localDescription
        return {"description": {"type": d.type, "sdp": d.sdp}}

    async def close(self):
        await self.pc.close()


@pytest.fixture
async def world():
    backend = FakeBackend()
    signals: list[tuple[str, dict]] = []
    allowed = {"value": False}

    async def send_signal(stream_id, payload):
        signals.append((stream_id, payload))

    manager = StreamManager(
        backend,
        lambda: FakeFrameSource(fps=12, width=160, height=120),
        send_signal,
        lambda stream_id: allowed["value"] and stream_id == "s1",
    )
    peer = Peer()
    yield manager, backend, signals, allowed, peer
    await manager.stop_all()
    await peer.close()


async def wait_until(pred, limit=5):
    async with asyncio.timeout(limit):
        while not pred():
            await asyncio.sleep(0.02)


async def test_loopback_video_and_gated_input(world):
    manager, backend, signals, allowed, peer = world
    await manager.start("s1", [{"urls": ["stun:unused.invalid:3478"]}])
    assert manager.stream_ids == ["s1"]
    stream_id, payload = signals[0]
    assert stream_id == "s1" and payload["description"]["type"] == "offer"
    assert "m=video" in payload["description"]["sdp"]

    await manager.signal("s1", await peer.answer(payload["description"]))
    frame = await asyncio.wait_for(peer.frame, 10)
    assert frame.width == 160 and frame.height == 120

    channel = await asyncio.wait_for(peer.channel, 5)
    assert channel.label == "input"
    await wait_until(lambda: channel.readyState == "open")

    # Refused: the gate says no. Nothing reaches the backend.
    channel.send(json.dumps({"kind": "mouse.move", "x": 0.5, "y": 0.5}))
    await wait_until(lambda: manager.dropped == 1)
    assert backend.calls == []

    # Allowed: the gate says yes. The event reaches the backend as sent.
    allowed["value"] = True
    channel.send(json.dumps({"kind": "key.down", "key": "a", "code": "KeyA"}))
    await wait_until(lambda: backend.calls)
    assert backend.calls == [("input", ({"kind": "key.down", "key": "a", "code": "KeyA"},))]

    # Garbage and unknown kinds are dropped without a call.
    channel.send("not json")
    channel.send(json.dumps({"kind": "format.disk"}))
    channel.send(json.dumps({"kind": "mouse.up", "x": 1, "y": 1, "button": 0}))
    await wait_until(lambda: len(backend.calls) == 2)
    assert backend.calls[1][1][0]["kind"] == "mouse.up"

    await manager.stop("s1")
    assert manager.stream_ids == []
    await manager.signal("s1", {"candidate": {"candidate": ""}})  # unknown stream: dropped


async def test_signal_accepts_browser_candidates(world):
    manager, backend, signals, allowed, peer = world
    await manager.start("s2", [])
    await manager.signal("s2", await peer.answer(signals[0][1]["description"]))
    await manager.signal(
        "s2",
        {
            "candidate": {
                "candidate": "candidate:1 1 udp 2130706431 127.0.0.1 40000 typ host",
                "sdpMid": "0",
                "sdpMLineIndex": 0,
            }
        },
    )
    await manager.signal("s2", {"candidate": {"candidate": "", "sdpMid": None}})
    assert manager.stream_ids == ["s2"]


async def test_track_sets_pts_and_time_base():
    track = ScreenTrack(FakeFrameSource(fps=50, width=8, height=6))
    first = await track.recv()
    second = await track.recv()
    assert first.pts == 0 and second.pts > first.pts
    assert first.time_base.denominator == 90_000
    assert first.format.name == "rgb24" and first.width == 8
    track.stop()
    with pytest.raises(RuntimeError):
        await track.recv()


async def test_fake_source_can_use_the_backend_screenshot():
    src = FakeFrameSource(fps=100, width=8, height=6, backend=FakeBackend())
    f = await src.frame()
    assert (f.width, f.height, f.format.name) == (8, 6, "rgb24")
    assert bytes(f.planes[0])[:3] == bytes((10, 20, 30))


def test_rgb_frame_handles_odd_strides():
    f = rgb_frame(7, 3, bytes([1, 2, 3]) * 21)
    assert bytes(f.planes[0])[:3] == b"\x01\x02\x03"
    assert f.width == 7 and f.height == 3


def test_x11_source_argv(monkeypatch):
    monkeypatch.setattr("agentd.stream.shutil.which", lambda name: "/usr/bin/ffmpeg")
    argv = X11FrameSource(":0", 12, 1280, 800).argv()
    assert argv[:1] == ["ffmpeg"] and "x11grab" in argv
    assert argv[argv.index("-framerate") + 1] == "12"
    assert argv[argv.index("-video_size") + 1] == "1280x800"
    assert argv[argv.index("-pix_fmt") + 1] == "rgb24" and argv[-1] == "-"


def test_keysym_map_covers_the_common_keys():
    assert keysym("a", "KeyA") == "a" and keysym("A", "KeyA") == "a"
    assert keysym("1", "Digit1") == "1" and keysym("!", "Digit1") == "1"
    assert keysym("Enter", "Enter") == "Return"
    assert keysym("Backspace", "Backspace") == "BackSpace"
    assert keysym("Tab", "Tab") == "Tab" and keysym("Escape", "Escape") == "Escape"
    assert keysym("ArrowLeft", "ArrowLeft") == "Left"
    assert keysym("Shift", "ShiftLeft") == "Shift_L" and keysym("Meta", "MetaRight") == "Super_R"
    assert keysym(" ", "Space") == "space" and keysym("/", "Slash") == "slash"
    # Without a code the key alone decides; unknown keys map to nothing.
    assert keysym("Control", None) == "Control_L" and keysym(";", None) == "semicolon"
    assert keysym("é", None) is None and keysym("Dead", None) is None


def test_input_argv_maps_events_to_xdotool():
    w, h = 1280, 800
    assert input_argv({"kind": "mouse.move", "x": 0.5, "y": 0.5}, w, h) == [
        ["mousemove", "640", "400"]
    ]
    assert input_argv({"kind": "mouse.down", "x": 0, "y": 0, "button": 2}, w, h) == [
        ["mousemove", "0", "0"],
        ["mousedown", "3"],
    ]
    assert input_argv({"kind": "mouse.up", "x": 1, "y": 1, "button": 0}, w, h) == [
        ["mousemove", "1279", "799"],
        ["mouseup", "1"],
    ]
    assert input_argv({"kind": "wheel", "x": 0.5, "y": 0.5, "dx": 0, "dy": -250}, w, h) == [
        ["mousemove", "640", "400"],
        ["click", "--repeat", "2", "4"],
    ]
    assert input_argv({"kind": "wheel", "x": 0.5, "y": 0.5, "dx": 30, "dy": 0}, w, h) == [
        ["mousemove", "640", "400"],
        ["click", "--repeat", "1", "7"],
    ]
    assert input_argv({"kind": "key.down", "key": "Enter", "code": "Enter"}, w, h) == [
        ["keydown", "Return"]
    ]
    assert input_argv({"kind": "key.up", "key": "Dead", "code": ""}, w, h) == []
    assert input_argv({"kind": "touch", "x": 0.25, "y": 0.5, "key": "start"}, w, h) == [
        ["mousemove", "320", "400"],
        ["mousedown", "1"],
    ]
    assert input_argv({"kind": "touch", "x": 0.25, "y": 0.5, "key": "move"}, w, h) == [
        ["mousemove", "320", "400"]
    ]
    assert input_argv({"kind": "touch", "x": 0.25, "y": 0.5, "key": "end"}, w, h) == [
        ["mousemove", "320", "400"],
        ["mouseup", "1"],
    ]
    # Out-of-range coordinates clamp; unknown kinds map to nothing.
    assert input_argv({"kind": "mouse.move", "x": 7, "y": -3}, w, h) == [["mousemove", "1279", "0"]]
    assert input_argv({"kind": "nope"}, w, h) == []
