"""agentd core: tasks, kernels, tools, limits. Transport-free.

``AgentdCore.handle`` takes one server message and ``send`` carries
messages back. ``lib_request`` serves agentlib calls from the kernels.
Tests drive both directly; ``main.py`` wires them to a WebSocket and a
Unix socket.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from apparatus_protocol import (
    A2S,
    LIB,
    S2A,
    EventKind,
    HandoffOutcome,
    ProtocolError,
    msg,
    parse,
)

from . import disk
from .config import AgentdConfig
from .desktop import CaptureRefused, DesktopBackend, DesktopBusy, DesktopLock, run_action
from .kernel import Kernel, KernelDead
from .stream import FakeFrameSource, FrameSource, StreamManager, X11FrameSource
from .tasklog import TaskLog

log = logging.getLogger("agentd")
Send = Callable[[dict[str, Any]], Awaitable[None]]

# A blocking agentlib call waits at most this long for the server. The
# server applies the real limits (handoff and approval wait minutes).
BLOCK_MAX_SECONDS = 24 * 3600


@dataclass
class Task:
    task_id: str
    job_id: str
    request: str
    wall_seconds: float
    max_steps: int
    tlog: TaskLog
    kernel: Kernel
    started_at: float = field(default_factory=time.monotonic)
    steps: int = 0
    paused: bool = False
    handoff_id: str | None = None
    pending: dict[str, asyncio.Future] = field(default_factory=dict)
    restored: bool = False

    @property
    def wall_left(self) -> float:
        return self.wall_seconds - (time.monotonic() - self.started_at)

    def state(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "job_id": self.job_id,
            "steps": self.steps,
            "paused": self.paused,
            "handoff_id": self.handoff_id,
            "kernel_alive": self.kernel.alive,
            "wall_left_seconds": round(self.wall_left, 1),
            "blocked_on": sorted(self.pending),
        }


class AgentdCore:
    def __init__(
        self,
        cfg: AgentdConfig,
        backend: DesktopBackend,
        send: Send,
        streams: StreamManager | None = None,
    ):
        self.cfg = cfg
        self.backend = backend
        self.send = send
        self.tasks: dict[str, Task] = {}
        self.lock = DesktopLock(cfg.desktop_lock_wait_seconds)
        self.user_control = False
        # The stream of the device that holds control; input flows on it alone.
        self.control_stream_id: str | None = None
        self._running: set[asyncio.Task] = set()
        self.streams = streams or StreamManager(
            backend, self._frame_source, self._send_signal, self.input_allowed
        )
        disk.ensure_layout(cfg.home)

    def _frame_source(self) -> FrameSource:
        c = self.cfg
        if c.desktop == "xdo":
            return X11FrameSource(c.display, c.stream_fps, c.stream_width, c.stream_height)
        return FakeFrameSource(c.stream_fps, 160, 120, backend=self.backend)

    async def _send_signal(self, stream_id: str, payload: dict[str, Any]) -> None:
        await self.send(msg(A2S.SIGNAL, stream_id=stream_id, payload=payload))

    def input_allowed(self, stream_id: str) -> bool:
        """Stream input reaches the desktop during a handoff, or from the controlling stream."""
        if self.handoff_active:
            return True
        return self.user_control and stream_id == self.control_stream_id

    def capture_allowed(self) -> bool:
        """A task may capture the screen only while nobody else holds it."""
        return not self.handoff_active and not self.user_control

    # ------------------------------------------------------------------ #
    # Server -> agentd
    # ------------------------------------------------------------------ #

    async def handle(self, raw: str | bytes | dict[str, Any]) -> None:
        try:
            m = parse(raw, S2A.ALL)
        except ProtocolError as e:
            await self.send(msg(A2S.LOG, level="warning", message=f"bad message: {e}"))
            return
        t = m["type"]
        handler = {
            S2A.TASK_START: self.task_start,
            S2A.TASK_STOP: self.task_stop,
            S2A.TASK_PAUSE: self.task_pause,
            S2A.TOOL_CALL: self.tool_call,
            S2A.HANDOFF_RESUME: self.handoff_resume,
            S2A.APPROVAL_ANSWER: self.approval_answer,
            S2A.API_RESULT: self.api_result,
            S2A.STREAM_START: self.stream_start,
            S2A.STREAM_STOP: self.stream_stop,
            S2A.CONTROL: self.control,
            S2A.SIGNAL: self.signal,
            S2A.VM_STATUS: self.vm_status,
        }[t]
        await handler(m)

    async def task_start(self, m: dict[str, Any]) -> None:
        task_id = m["task_id"]
        try:
            tdir = disk.task_dir(self.cfg.home, task_id)
        except ValueError as e:
            await self.send(msg(A2S.LOG, level="error", message=str(e)))
            return
        existing = self.tasks.get(task_id)
        if existing and existing.kernel.alive:
            await self._send_started(existing)
            return
        budget = m.get("budget") or {}
        tdir.mkdir(parents=True, exist_ok=True)
        tlog = TaskLog(tdir)
        restored = tlog.path.exists()
        kernel = Kernel(
            task_id,
            tdir,
            tools_dir=disk.tools_dir(self.cfg.home),
            socket_path=self.cfg.socket_path,
            home=self.cfg.home,
            max_output_chars=self.cfg.max_output_chars,
            kernel_user=self.cfg.kernel_user,
        )
        await kernel.start()
        task = Task(
            task_id=task_id,
            job_id=m["job_id"],
            request=m["request"],
            wall_seconds=float(budget.get("wall_seconds", 900)),
            max_steps=int(budget.get("steps", 40)),
            tlog=tlog,
            kernel=kernel,
            restored=restored,
        )
        if restored:
            prior = tlog.restore()
            task.steps = prior["steps"]
            # A handoff that was open when agentd stopped is still open on the server.
            task.paused = bool(prior.get("paused"))
            task.handoff_id = prior.get("handoff_id") if task.paused else None
        self.tasks[task_id] = task
        tlog.append(
            "task.start", job_id=task.job_id, request=task.request, budget=budget, restored=restored
        )
        await self._send_started(task)

    async def _send_started(self, task: Task) -> None:
        await self.send(
            msg(
                A2S.TASK_STARTED,
                task_id=task.task_id,
                memory_index=disk.read_index(disk.memory_index(self.cfg.home)),
                tools_index=disk.read_index(disk.tools_index(self.cfg.home)),
                restored=task.restored,
                task_dir=str(task.tlog.dir),
            )
        )

    async def task_stop(self, m: dict[str, Any]) -> None:
        task = self.tasks.pop(m["task_id"], None)
        if task is None:
            await self.send(msg(A2S.TASK_STOPPED, task_id=m["task_id"]))
            return
        for fut in task.pending.values():
            if not fut.done():
                fut.set_result({"ok": False, "error": "task stopped"})
        await task.kernel.kill()
        await self.lock.release(task.task_id)
        result = m.get("result")
        if isinstance(result, dict):
            task.tlog.write_result(result)
        task.tlog.append("task.stop", reason=m.get("reason"))
        await self.send(msg(A2S.TASK_STOPPED, task_id=task.task_id))

    async def task_pause(self, m: dict[str, Any]) -> None:
        task = self.tasks.get(m["task_id"])
        if task is None:
            return
        task.paused = True
        task.handoff_id = m["handoff_id"]
        task.tlog.append("task.pause", handoff_id=task.handoff_id, reason=m.get("reason"))

    @property
    def handoff_active(self) -> bool:
        """True while any task is in a handoff. The screen belongs to the user."""
        return any(t.paused and t.handoff_id for t in self.tasks.values())

    async def tool_call(self, m: dict[str, Any]) -> None:
        call_id, task_id, name, args = m["id"], m["task_id"], m["name"], m["args"]

        async def fail(error: str) -> None:
            await self.send(
                msg(A2S.TOOL_RESULT, id=call_id, task_id=task_id, ok=False, error=error)
            )

        task = self.tasks.get(task_id)
        if task is None:
            return await fail("unknown_task: start the task first")
        if task.paused:
            return await fail("task_paused: a handoff is in progress")
        if task.steps >= task.max_steps:
            return await fail(f"budget_exceeded: {task.max_steps} steps used")
        if task.wall_left <= 0:
            return await fail(f"budget_exceeded: wall time of {task.wall_seconds:.0f} s used")
        task.steps += 1
        task.tlog.append("tool.call", id=call_id, name=name, args=_trim_args(args))
        # The call runs on its own so the link keeps handling handoff.resume,
        # approval.answer and control while a step blocks in agentlib.
        runner = asyncio.ensure_future(self._run_tool(task, call_id, name, args))
        self._running.add(runner)
        runner.add_done_callback(self._running.discard)

    async def _run_tool(self, task: Task, call_id: str, name: str, args: dict[str, Any]) -> None:
        started = time.monotonic()
        try:
            if name == "python":
                result = await self._python(task, args)
            elif name == "computer":
                result = await self._computer(task, args)
            else:
                result = {"ok": False, "error": f"unknown_tool: {name}"}
        except DesktopBusy as e:
            result = {"ok": False, "error": str(e)}
        except CaptureRefused as e:
            result = {"ok": False, "error": str(e)}
        except KernelDead as e:
            result = {"ok": False, "error": f"kernel_dead: {e}"}
        except (ValueError, RuntimeError) as e:
            result = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        task.tlog.append(
            "tool.result",
            id=call_id,
            ok=result.get("ok"),
            seconds=round(time.monotonic() - started, 3),
            error=result.get("error"),
            output_chars=len(result.get("output") or ""),
            files=result.get("files"),
        )
        await self.send(msg(A2S.TOOL_RESULT, id=call_id, task_id=task.task_id, **result))

    async def _python(self, task: Task, args: dict[str, Any]) -> dict[str, Any]:
        code = args.get("code")
        if not isinstance(code, str):
            return {"ok": False, "error": "python needs a code string"}
        if not task.kernel.alive:
            await task.kernel.start()
            task.tlog.append("kernel.restart")
        timeout = float(args.get("timeout", self.cfg.python_timeout_seconds))
        timeout = min(timeout, max(task.wall_left, 1.0))
        r = await task.kernel.execute(code, timeout)
        return {
            "ok": r.ok,
            "output": r.output,
            "error": r.error,
            "files": r.files,
            "killed": r.killed,
        }

    async def _computer(self, task: Task, args: dict[str, Any]) -> dict[str, Any]:
        if self.handoff_active:
            # During a handoff nothing captures the screen. No exceptions.
            return {
                "ok": False,
                "error": "handoff_active: the user controls the screen; no screenshots",
            }
        if self.user_control:
            return {"ok": False, "error": "user_control: the user controls the desktop"}
        await self.lock.acquire(task.task_id)
        # The wait for the lock is a window: check again before touching the desktop.
        if self.handoff_active:
            return {
                "ok": False,
                "error": "handoff_active: the user controls the screen; no screenshots",
            }
        if self.user_control:
            return {"ok": False, "error": "user_control: the user controls the desktop"}
        out = await run_action(self.backend, args, capture_allowed=self.capture_allowed)
        return {"ok": True, **out}

    async def handoff_resume(self, m: dict[str, Any]) -> None:
        task = self.tasks.get(m["task_id"])
        if task is None:
            return
        outcome = m["outcome"] if m["outcome"] in HandoffOutcome.ALL else HandoffOutcome.CANCEL
        task.paused = False
        handoff_id = task.handoff_id
        task.handoff_id = None
        task.tlog.append("task.resume", handoff_id=handoff_id, outcome=outcome)
        self._resolve(task, handoff_id, {"ok": True, "outcome": outcome})

    async def approval_answer(self, m: dict[str, Any]) -> None:
        task = self.tasks.get(m["task_id"])
        if task is None:
            return
        task.tlog.append("approval.answer", approval_id=m["approval_id"], approved=m["approved"])
        self._resolve(task, m["approval_id"], {"ok": True, "approved": bool(m["approved"])})

    async def api_result(self, m: dict[str, Any]) -> None:
        task = self.tasks.get(m["task_id"])
        if task is None:
            return
        reply = {"ok": bool(m["ok"]), "result": m.get("result"), "error": m.get("error")}
        self._resolve(task, m["request_id"], reply)

    # ------------------------------------------------------------------ #
    # screen stream and control
    # ------------------------------------------------------------------ #

    async def stream_start(self, m: dict[str, Any]) -> None:
        try:
            await self.streams.start(m["stream_id"], m["ice_servers"])
        except Exception as e:  # noqa: BLE001 - a failed stream is reported, not fatal
            log.warning("stream %s failed to start: %s", m["stream_id"], e)
            await self.send(
                msg(A2S.LOG, level="warning", message=f"stream {m['stream_id']} failed: {e}")
            )
        await self.send(self.vm_state())

    async def stream_stop(self, m: dict[str, Any]) -> None:
        await self.streams.stop(m["stream_id"])
        await self.send(self.vm_state())

    async def control(self, m: dict[str, Any]) -> None:
        self.user_control = bool(m["active"])
        sid = m.get("stream_id")
        self.control_stream_id = str(sid) if self.user_control and sid else None
        await self.send(self.vm_state())

    async def signal(self, m: dict[str, Any]) -> None:
        try:
            await self.streams.signal(m["stream_id"], m["payload"])
        except Exception as e:  # noqa: BLE001 - a bad answer ends that stream only
            log.warning("signal for stream %s failed: %s", m["stream_id"], e)
            await self.streams.stop(m["stream_id"])
            await self.send(self.vm_state())

    async def vm_status(self, m: dict[str, Any]) -> None:
        await self.send(self.vm_state())

    def vm_state(self) -> dict[str, Any]:
        out = msg(
            A2S.VM_STATE,
            tasks=[t.state() for t in self.tasks.values()],
            handoff_active=self.handoff_active,
            streams=self.streams.stream_ids,
            user_control=self.user_control,
            control_stream_id=self.control_stream_id,
        )
        out["desktop_owner"] = self.lock.owner  # explicit null: "nobody" is information
        return out

    def _resolve(self, task: Task, request_id: str | None, reply: dict[str, Any]) -> None:
        if request_id is None:
            return
        fut = task.pending.get(request_id)
        if fut is not None and not fut.done():
            fut.set_result(reply)

    # ------------------------------------------------------------------ #
    # agentlib -> agentd
    # ------------------------------------------------------------------ #

    async def lib_request(self, req: dict[str, Any]) -> dict[str, Any]:
        op = req.get("op")
        task = self.tasks.get(str(req.get("task_id")))
        if op not in LIB.ALL:
            return {"ok": False, "error": f"unknown op {op!r}"}
        if task is None:
            return {"ok": False, "error": "unknown task"}
        payload = {k: v for k, v in req.items() if k not in ("op", "task_id")}
        if op == LIB.SAY:
            await self._event(task, EventKind.SAY, payload)
            return {"ok": True}
        if op == LIB.PROGRESS:
            await self._event(task, EventKind.PROGRESS, payload)
            return {"ok": True}
        if op == LIB.SHOW:
            await self._event(task, EventKind.SHOW, payload)
            return {"ok": True}
        kind = {
            LIB.REQUEST_APPROVAL: EventKind.APPROVAL_REQUEST,
            LIB.API: EventKind.API_REQUEST,
            LIB.HANDOFF: EventKind.HANDOFF_REQUEST,
        }[op]
        request_id = uuid.uuid4().hex
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        task.pending[request_id] = fut
        task.kernel.blocked = True
        if op == LIB.HANDOFF:
            # The server answers with task.pause then handoff.resume. Until
            # then the task holds the desktop and makes no screenshots.
            task.paused = True
            task.handoff_id = request_id
        try:
            await self._event(task, kind, payload, request_id=request_id)
            return await asyncio.wait_for(fut, timeout=BLOCK_MAX_SECONDS)
        except TimeoutError:
            return {"ok": False, "error": "timeout"}
        finally:
            task.pending.pop(request_id, None)
            task.kernel.blocked = bool(task.pending)
            if op == LIB.HANDOFF and task.handoff_id == request_id:
                task.paused = False
                task.handoff_id = None

    async def _event(
        self, task: Task, kind: str, payload: dict[str, Any], request_id: str | None = None
    ) -> None:
        task.tlog.append("event", event=kind, request_id=request_id, payload=_trim_args(payload))
        await self.send(
            msg(A2S.EVENT, task_id=task.task_id, kind=kind, request_id=request_id, payload=payload)
        )

    # ------------------------------------------------------------------ #

    async def shutdown(self) -> None:
        for t in list(self._running):
            t.cancel()
        if self._running:
            await asyncio.gather(*self._running, return_exceptions=True)
        await self.streams.stop_all()
        for task in list(self.tasks.values()):
            await task.kernel.kill()


def _trim_args(args: dict[str, Any], limit: int = 2000) -> dict[str, Any]:
    out = {}
    for k, v in args.items():
        s = v if isinstance(v, (int, float, bool)) or v is None else str(v)
        if isinstance(s, str) and len(s) > limit:
            s = s[:limit] + f"...[{len(s) - limit} more]"
        out[k] = s
    return out
