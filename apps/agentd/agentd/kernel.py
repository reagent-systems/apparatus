"""One persistent Python session for one task, run as a child process.

The kernel is working memory only. agentd kills it on budget overrun, on
``task.stop`` and when the VM goes idle. Anything that matters is on disk.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import kernel_child

# agentlib lives next to the agentd package; the kernel imports it from here.
_PYTHONPATH = str(Path(kernel_child.__file__).resolve().parent.parent)


@dataclass
class ExecResult:
    ok: bool
    output: str = ""
    error: str | None = None
    files: list[str] = field(default_factory=list)
    killed: bool = False
    seconds: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "output": self.output,
            "error": self.error,
            "files": self.files,
            "killed": self.killed,
            "seconds": round(self.seconds, 3),
        }


class KernelDead(RuntimeError):
    pass


class Kernel:
    def __init__(
        self,
        task_id: str,
        task_dir: Path,
        *,
        tools_dir: Path,
        socket_path: Path,
        home: Path,
        max_output_chars: int = 50000,
        kernel_user: str | None = None,
        python: str | None = None,
    ):
        self.task_id = task_id
        self.task_dir = task_dir
        self.tools_dir = tools_dir
        self.socket_path = socket_path
        self.home = home
        self.max_output_chars = max_output_chars
        self.kernel_user = kernel_user
        self.python = python or sys.executable
        self.proc: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()
        self._next_id = 0
        # Set by the owner while a blocking agentlib call is pending for this
        # task. The execution deadline does not advance while it is set.
        self.blocked = False

    @property
    def alive(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    async def start(self) -> None:
        self.task_dir.mkdir(parents=True, exist_ok=True)
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(self.home),
            "LANG": "C.UTF-8",
            "PYTHONUNBUFFERED": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "AGENT_TASK_ID": self.task_id,
            "AGENT_TASK_DIR": str(self.task_dir),
            "AGENT_TOOLS_DIR": str(self.tools_dir),
            "AGENTD_SOCKET": str(self.socket_path),
            "AGENTD_MAX_OUTPUT_CHARS": str(self.max_output_chars),
            "PYTHONPATH": _PYTHONPATH,
        }
        # No DISPLAY or XAUTHORITY: task code is for computing, the computer tool is for
        # the desktop. (Isolation of the X socket itself is a roadmap item.)
        argv = [self.python, "-m", "agentd.kernel_child"]
        if self.kernel_user:
            argv = [
                "sudo",
                "-n",
                "-u",
                self.kernel_user,
                "env",
                *(f"{k}={v}" for k, v in env.items()),
                *argv,
            ]
        self.proc = await asyncio.create_subprocess_exec(
            *argv,
            cwd=str(self.task_dir),
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True,
        )

    async def execute(self, code: str, limit_seconds: float) -> ExecResult:
        """Run ``code``. Kill the kernel if it runs past ``limit_seconds``.

        Time spent waiting on a blocking agentlib call (approval, api,
        handoff) does not count against the timeout.
        """
        if not self.alive:
            raise KernelDead("kernel is not running")
        assert self.proc and self.proc.stdin and self.proc.stdout
        async with self._lock:
            self._next_id += 1
            rid = str(self._next_id)
            self.proc.stdin.write((json.dumps({"id": rid, "code": code}) + "\n").encode())
            await self.proc.stdin.drain()
            started = time.monotonic()
            deadline = started + limit_seconds
            reader = asyncio.ensure_future(self.proc.stdout.readline())
            while True:
                done, _ = await asyncio.wait({reader}, timeout=0.2)
                if done:
                    break
                if self.blocked:
                    deadline = (
                        time.monotonic() + limit_seconds
                    )  # the clock restarts after the block
                    continue
                if time.monotonic() > deadline:
                    reader.cancel()
                    await self.kill()
                    return ExecResult(
                        ok=False,
                        error=(
                            f"TimeoutError: the step ran past {limit_seconds:.0f} s and the kernel was killed. "
                            "Variables are gone; files on disk remain."
                        ),
                        killed=True,
                        seconds=time.monotonic() - started,
                    )
            line = reader.result()
            if not line:
                await self.kill()
                return ExecResult(
                    ok=False,
                    error="KernelDead: the kernel exited",
                    killed=True,
                    seconds=time.monotonic() - started,
                )
            try:
                reply = json.loads(line)
            except json.JSONDecodeError:
                return ExecResult(
                    ok=False,
                    error="protocol error: bad reply from kernel",
                    seconds=time.monotonic() - started,
                )
            return ExecResult(
                ok=bool(reply.get("ok")),
                output=reply.get("output", ""),
                error=reply.get("error"),
                files=list(reply.get("files", [])),
                seconds=time.monotonic() - started,
            )

    async def kill(self) -> None:
        if self.proc is None:
            return
        if self.proc.returncode is None:
            try:
                os.killpg(os.getpgid(self.proc.pid), 9)
            except (ProcessLookupError, PermissionError):
                try:
                    self.proc.kill()
                except ProcessLookupError:
                    pass
            try:
                await asyncio.wait_for(self.proc.wait(), timeout=5)
            except TimeoutError:
                pass
