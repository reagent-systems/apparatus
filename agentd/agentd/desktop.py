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
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from apparatus_protocol import InputKind

ACTIONS = ("screenshot", "click", "double_click", "right_click", "move", "type", "key", "scroll")

# DOM KeyboardEvent.code -> X keysym, for the keys a user presses in a screen stream.
_KEYSYM_BY_CODE: dict[str, str] = {
    "Enter": "Return",
    "NumpadEnter": "KP_Enter",
    "Backspace": "BackSpace",
    "Tab": "Tab",
    "Escape": "Escape",
    "Space": "space",
    "Delete": "Delete",
    "Insert": "Insert",
    "Home": "Home",
    "End": "End",
    "PageUp": "Prior",
    "PageDown": "Next",
    "ArrowUp": "Up",
    "ArrowDown": "Down",
    "ArrowLeft": "Left",
    "ArrowRight": "Right",
    "ShiftLeft": "Shift_L",
    "ShiftRight": "Shift_R",
    "ControlLeft": "Control_L",
    "ControlRight": "Control_R",
    "AltLeft": "Alt_L",
    "AltRight": "Alt_R",
    "MetaLeft": "Super_L",
    "MetaRight": "Super_R",
    "CapsLock": "Caps_Lock",
    "Minus": "minus",
    "Equal": "equal",
    "BracketLeft": "bracketleft",
    "BracketRight": "bracketright",
    "Backslash": "backslash",
    "Semicolon": "semicolon",
    "Quote": "apostrophe",
    "Backquote": "grave",
    "Comma": "comma",
    "Period": "period",
    "Slash": "slash",
    **{f"F{n}": f"F{n}" for n in range(1, 13)},
    **{f"Key{c}": c.lower() for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"},
    **{f"Digit{d}": d for d in "0123456789"},
    **{f"Numpad{d}": f"KP_{d}" for d in "0123456789"},
}

# DOM KeyboardEvent.key -> X keysym, when the code is missing or unknown.
_KEYSYM_BY_KEY: dict[str, str] = {
    "Enter": "Return",
    "Backspace": "BackSpace",
    "Tab": "Tab",
    "Escape": "Escape",
    " ": "space",
    "Delete": "Delete",
    "Insert": "Insert",
    "Home": "Home",
    "End": "End",
    "PageUp": "Prior",
    "PageDown": "Next",
    "ArrowUp": "Up",
    "ArrowDown": "Down",
    "ArrowLeft": "Left",
    "ArrowRight": "Right",
    "Shift": "Shift_L",
    "Control": "Control_L",
    "Alt": "Alt_L",
    "Meta": "Super_L",
    "CapsLock": "Caps_Lock",
    "-": "minus",
    "=": "equal",
    "[": "bracketleft",
    "]": "bracketright",
    "\\": "backslash",
    ";": "semicolon",
    "'": "apostrophe",
    "`": "grave",
    ",": "comma",
    ".": "period",
    "/": "slash",
    "!": "exclam",
    "@": "at",
    "#": "numbersign",
    "$": "dollar",
    "%": "percent",
    "^": "asciicircum",
    "&": "ampersand",
    "*": "asterisk",
    "(": "parenleft",
    ")": "parenright",
    "_": "underscore",
    "+": "plus",
    "{": "braceleft",
    "}": "braceright",
    "|": "bar",
    ":": "colon",
    '"': "quotedbl",
    "~": "asciitilde",
    "<": "less",
    ">": "greater",
    "?": "question",
}


def keysym(key: str | None, code: str | None) -> str | None:
    """The xdotool keysym for one DOM key event, or None for a key we do not map."""
    if code and code in _KEYSYM_BY_CODE:
        return _KEYSYM_BY_CODE[code]
    if key is None:
        return None
    if key in _KEYSYM_BY_KEY:
        return _KEYSYM_BY_KEY[key]
    if len(key) == 1 and key.isascii() and key.isprintable():
        return key.lower() if key.isalpha() else key
    return None


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
    async def input_event(self, ev: dict[str, Any]) -> None: ...


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

    async def input_event(self, ev: dict[str, Any]) -> None:
        self.calls.append(("input", (ev,)))


class XdoBackend:
    """xdotool for input, ImageMagick ``import`` for the screen.

    ``width`` and ``height`` are the screen size; stream input events carry
    coordinates normalized over the video frame, which shows the whole screen.
    """

    def __init__(self, display: str = ":0", width: int = 1280, height: int = 800):
        self.display = display
        self.width = width
        self.height = height
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

    async def input_event(self, ev: dict[str, Any]) -> None:
        for argv in input_argv(ev, self.width, self.height):
            await self._run("xdotool", *argv)


def input_argv(ev: dict[str, Any], width: int, height: int) -> list[list[str]]:
    """xdotool argument lists for one stream input event. Unknown events map to none."""
    kind = ev.get("kind")

    def px() -> tuple[str, str]:
        x = min(max(float(ev.get("x", 0) or 0), 0.0), 1.0)
        y = min(max(float(ev.get("y", 0) or 0), 0.0), 1.0)
        return str(int(round(x * (width - 1)))), str(int(round(y * (height - 1))))

    def button() -> str:
        return str(int(ev.get("button", 0) or 0) + 1)

    if kind == InputKind.MOUSE_MOVE:
        return [["mousemove", *px()]]
    if kind == InputKind.MOUSE_DOWN:
        return [["mousemove", *px()], ["mousedown", button()]]
    if kind == InputKind.MOUSE_UP:
        return [["mousemove", *px()], ["mouseup", button()]]
    if kind == InputKind.WHEEL:
        out = [["mousemove", *px()]]
        dy = float(ev.get("dy", 0) or 0)
        dx = float(ev.get("dx", 0) or 0)
        # A browser wheel notch is about 100 px. One xdotool click per notch, at least one.
        if dy:
            out.append(["click", "--repeat", str(_notches(dy)), "5" if dy > 0 else "4"])
        if dx:
            out.append(["click", "--repeat", str(_notches(dx)), "7" if dx > 0 else "6"])
        return out
    if kind in (InputKind.KEY_DOWN, InputKind.KEY_UP):
        sym = keysym(ev.get("key"), ev.get("code"))
        if sym is None:
            return []
        return [["keydown" if kind == InputKind.KEY_DOWN else "keyup", sym]]
    if kind == InputKind.TOUCH:
        phase = ev.get("key")
        if phase == "start":
            return [["mousemove", *px()], ["mousedown", "1"]]
        if phase == "move":
            return [["mousemove", *px()]]
        if phase == "end":
            return [["mousemove", *px()], ["mouseup", "1"]]
    return []


def _notches(delta: float) -> int:
    return max(1, min(10, int(round(abs(delta) / 100))))


def make_backend(
    kind: str, display: str = ":0", width: int = 1280, height: int = 800
) -> DesktopBackend:
    if kind == "xdo":
        return XdoBackend(display, width, height)
    if kind == "fake":
        return FakeBackend()
    raise ValueError(f"unknown desktop backend {kind!r}")


class CaptureRefused(RuntimeError):
    """The screen may not be captured right now (a handoff or user control began)."""


async def run_action(
    backend: DesktopBackend,
    args: dict[str, Any],
    capture_allowed: Callable[[], bool] | None = None,
) -> dict[str, Any]:
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
        # The model may set settle_seconds; it is clamped so a call cannot park on the desktop.
        await asyncio.sleep(min(max(float(args.get("settle_seconds", 0.3)), 0.0), 2.0))
        note = f"{action} done. "
    # Re-check right before the capture: a handoff or user control may have begun
    # while the action settled. Nothing captures the screen in that case.
    if capture_allowed is not None and not capture_allowed():
        raise CaptureRefused("capture_refused: the user holds the screen; no screenshot")
    png = await backend.screenshot()
    return {"image_b64": base64.b64encode(png).decode(), "output": note + "Screenshot attached."}
