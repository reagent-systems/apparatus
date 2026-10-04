"""The one desktop: one screen, one mouse, one keyboard, one lock.

``DesktopLock`` lets one task control the desktop at a time. A second task
waits a short time and then gets ``desktop_busy``. ``computer`` actions go
through a ``DesktopBackend``: ``XdoBackend`` drives a real X display with
xdotool and ImageMagick; ``FakeBackend`` records calls for tests.
"""

from __future__ import annotations

import asyncio
import base64
import shutil
import struct
import zlib
from dataclasses import dataclass, field
from typing import Any, Protocol

ACTIONS = ("screenshot", "click", "double_click", "right_click", "move", "type", "key", "scroll")


class DesktopBusy(RuntimeError):
    """Another task holds the desktop."""


class DesktopLock:
    def __init__(self, wait_seconds: float = 5.0):
        self.wait_seconds = wait_seconds
        self.owner: str | None = None
        self._cond = asyncio.Condition()

    async def acquire(self, task_id: str) -> None:
        async with self._cond:
            if self.owner == task_id:
                return
            try:
                await asyncio.wait_for(
                    self._cond.wait_for(lambda: self.owner is None), timeout=self.wait_seconds
                )
            except TimeoutError:
                raise DesktopBusy(f"desktop_busy: task {self.owner} controls the desktop") from None
            self.owner = task_id

    async def release(self, task_id: str) -> None:
        async with self._cond:
            if self.owner == task_id:
                self.owner = None
                self._cond.notify_all()


class DesktopBackend(Protocol):
    async def screenshot(self) -> bytes: ...
    async def click(self, x: int, y: int, button: int = 1, count: int = 1) -> None: ...
    async def move(self, x: int, y: int) -> None: ...
    async def type_text(self, text: str) -> None: ...
    async def key(self, combo: str) -> None: ...
    async def scroll(self, x: int, y: int, dx: int, dy: int) -> None: ...


def tiny_png(width: int = 1, height: int = 1, rgb: tuple[int, int, int] = (0, 0, 0)) -> bytes:
    """A valid PNG with no dependencies, for the fake backend and tests."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    row = b"\x00" + bytes(rgb) * width
    raw = row * height
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


@dataclass
class FakeBackend:
    calls: list[tuple[str, tuple[Any, ...]]] = field(default_factory=list)

    async def screenshot(self) -> bytes:
        self.calls.append(("screenshot", ()))
        return tiny_png(4, 4, (10, 20, 30))

    async def click(self, x: int, y: int, button: int = 1, count: int = 1) -> None:
        self.calls.append(("click", (x, y, button, count)))

    async def move(self, x: int, y: int) -> None:
        self.calls.append(("move", (x, y)))

    async def type_text(self, text: str) -> None:
        self.calls.append(("type", (text,)))

    async def key(self, combo: str) -> None:
        self.calls.append(("key", (combo,)))

    async def scroll(self, x: int, y: int, dx: int, dy: int) -> None:
        self.calls.append(("scroll", (x, y, dx, dy)))


class XdoBackend:
    """xdotool for input, ImageMagick ``import`` for the screen."""

    def __init__(self, display: str = ":0"):
        self.display = display
        for tool in ("xdotool", "import"):
            if shutil.which(tool) is None:
                raise RuntimeError(f"{tool} is not installed")

    async def _run(self, *argv: str, stdin: bytes | None = None) -> bytes:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            env={"DISPLAY": self.display, "PATH": "/usr/local/bin:/usr/bin:/bin"},
            stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(proc.communicate(stdin), timeout=30)
        if proc.returncode != 0:
            raise RuntimeError(f"{argv[0]} failed: {err.decode(errors='replace').strip()}")
        return out

    async def screenshot(self) -> bytes:
        return await self._run("import", "-window", "root", "png:-")

    async def click(self, x: int, y: int, button: int = 1, count: int = 1) -> None:
        await self._run(
            "xdotool", "mousemove", str(x), str(y), "click", "--repeat", str(count), str(button)
        )

    async def move(self, x: int, y: int) -> None:
        await self._run("xdotool", "mousemove", str(x), str(y))

    async def type_text(self, text: str) -> None:
        await self._run("xdotool", "type", "--delay", "12", "--file", "-", stdin=text.encode())

    async def key(self, combo: str) -> None:
        await self._run("xdotool", "key", "--clearmodifiers", combo)

    async def scroll(self, x: int, y: int, dx: int, dy: int) -> None:
        await self.move(x, y)
        if dy:
            await self._run("xdotool", "click", "--repeat", str(abs(dy)), "5" if dy > 0 else "4")
        if dx:
            await self._run("xdotool", "click", "--repeat", str(abs(dx)), "7" if dx > 0 else "6")


def make_backend(kind: str, display: str = ":0") -> DesktopBackend:
    if kind == "xdo":
        return XdoBackend(display)
    if kind == "fake":
        return FakeBackend()
    raise ValueError(f"unknown desktop backend {kind!r}")


async def run_action(backend: DesktopBackend, args: dict[str, Any]) -> dict[str, Any]:
    """Run one ``computer`` action and return ``{"image_b64", "output"}``.

    Every action ends with a screenshot, so the model sees the result.
    """
    action = args.get("action")
    if action not in ACTIONS:
        raise ValueError(f"computer.action must be one of {ACTIONS}")

    def xy() -> tuple[int, int]:
        try:
            return int(args["x"]), int(args["y"])
        except (KeyError, TypeError, ValueError):
            raise ValueError(f"computer.{action} needs integer x and y") from None

    note = ""
    if action == "click":
        await backend.click(*xy(), button=1)
    elif action == "double_click":
        await backend.click(*xy(), button=1, count=2)
    elif action == "right_click":
        await backend.click(*xy(), button=3)
    elif action == "move":
        await backend.move(*xy())
    elif action == "type":
        text = args.get("text")
        if not isinstance(text, str):
            raise ValueError("computer.type needs text")
        await backend.type_text(text)
    elif action == "key":
        combo = args.get("keys") or args.get("key")
        if not isinstance(combo, str):
            raise ValueError("computer.key needs keys, for example ctrl+l or Return")
        await backend.key(combo)
    elif action == "scroll":
        x, y = xy()
        await backend.scroll(x, y, int(args.get("dx", 0)), int(args.get("dy", 0)))
    if action != "screenshot":
        await asyncio.sleep(float(args.get("settle_seconds", 0.3)))
        note = f"{action} done. "
    png = await backend.screenshot()
    return {"image_b64": base64.b64encode(png).decode(), "output": note + "Screenshot attached."}
