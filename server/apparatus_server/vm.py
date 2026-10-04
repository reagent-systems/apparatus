"""VMs: the agentd link for each user, and the controller that starts and
stops the machine.

The VM dials out. ``VmLink`` wraps one connected agentd and turns the
message stream into awaitable calls. ``VmRegistry`` finds the link for a
user and hands events to the job manager. ``VmController`` starts and stops
the machine itself: ``local`` is a no-op for development; ``gce`` calls the
Compute Engine API. ``IdleStopper`` stops a VM after idle time.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

import httpx

from apparatus_protocol import A2S, S2A, msg

log = logging.getLogger("apparatus.vm")
Send = Callable[[dict[str, Any]], Awaitable[None]]
EventHandler = Callable[[str, dict[str, Any]], Awaitable[None]]


class VmDisconnected(RuntimeError):
    pass


class VmUnavailable(RuntimeError):
    pass


def enrollment_auth(secret: str, vm_id: str) -> str:
    return hmac.new(secret.encode(), vm_id.encode(), hashlib.sha256).hexdigest()


def verify_enrollment(secret: str, vm_id: str, auth: str) -> bool:
    """With an empty secret (development) every VM is accepted."""
    if not secret:
        return True
    return hmac.compare_digest(enrollment_auth(secret, vm_id), str(auth))


class VmLink:
    def __init__(
        self, vm_id: str, user_id: str, send: Send, capabilities: dict[str, Any] | None = None
    ):
        self.vm_id = vm_id
        self.user_id = user_id
        self._send = send
        self.capabilities = capabilities or {}
        self.connected_at = time.time()
        self.state: dict[str, Any] = {}
        self._tool_waits: dict[str, asyncio.Future] = {}
        self._start_waits: dict[str, asyncio.Future] = {}
        self._stop_waits: dict[str, asyncio.Future] = {}
        self.alive = True

    # -------------------------------------------------------------- #
    # calls into the VM
    # -------------------------------------------------------------- #

    async def start_task(
        self, task_id: str, job_id: str, request: str, budget: dict[str, Any], timeout: float = 60
    ) -> dict[str, Any]:
        fut = self._wait(self._start_waits, task_id)
        await self._send(
            msg(S2A.TASK_START, task_id=task_id, job_id=job_id, request=request, budget=budget)
        )
        return await self._await(fut, timeout, "task.start")

    async def stop_task(
        self, task_id: str, reason: str, result: dict[str, Any] | None = None, timeout: float = 30
    ) -> None:
        fut = self._wait(self._stop_waits, task_id)
        await self._send(msg(S2A.TASK_STOP, task_id=task_id, reason=reason, result=result))
        try:
            await self._await(fut, timeout, "task.stop")
        except (TimeoutError, VmDisconnected):
            pass

    async def call_tool(
        self, task_id: str, name: str, args: dict[str, Any], timeout: float
    ) -> dict[str, Any]:
        call_id = uuid.uuid4().hex
        fut = self._wait(self._tool_waits, call_id)
        await self._send(msg(S2A.TOOL_CALL, id=call_id, task_id=task_id, name=name, args=args))
        return await self._await(fut, timeout, f"tool {name}")

    async def pause_task(self, task_id: str, handoff_id: str, reason: str) -> None:
        await self._send(msg(S2A.TASK_PAUSE, task_id=task_id, handoff_id=handoff_id, reason=reason))

    async def resume_handoff(self, task_id: str, handoff_id: str, outcome: str) -> None:
        await self._send(
            msg(S2A.HANDOFF_RESUME, task_id=task_id, handoff_id=handoff_id, outcome=outcome)
        )

    async def answer_approval(self, task_id: str, approval_id: str, approved: bool) -> None:
        await self._send(
            msg(S2A.APPROVAL_ANSWER, task_id=task_id, approval_id=approval_id, approved=approved)
        )

    async def api_result(
        self, task_id: str, request_id: str, ok: bool, result: Any = None, error: str | None = None
    ) -> None:
        await self._send(
            msg(
                S2A.API_RESULT,
                task_id=task_id,
                request_id=request_id,
                ok=ok,
                result=result,
                error=error,
            )
        )

    async def signal(self, handoff_id: str, payload: dict[str, Any]) -> None:
        await self._send(msg(S2A.SIGNAL, handoff_id=handoff_id, payload=payload))

    # -------------------------------------------------------------- #
    # messages from the VM
    # -------------------------------------------------------------- #

    def on_message(self, m: dict[str, Any]) -> dict[str, Any] | None:
        """Resolve waits. Returns the message when the job manager must see it."""
        t = m["type"]
        if t == A2S.TOOL_RESULT:
            self._resolve(self._tool_waits, m["id"], m)
        elif t == A2S.TASK_STARTED:
            self._resolve(self._start_waits, m["task_id"], m)
        elif t == A2S.TASK_STOPPED:
            self._resolve(self._stop_waits, m["task_id"], m)
        elif t == A2S.VM_STATE:
            self.state = m
        elif t == A2S.LOG:
            log.log(
                logging.getLevelName(m["level"].upper()) if isinstance(m["level"], str) else 20,
                "vm %s: %s",
                self.vm_id,
                m["message"],
            )
        elif t in (A2S.EVENT, A2S.SIGNAL):
            return m
        return None

    def disconnect(self) -> None:
        self.alive = False
        for waits in (self._tool_waits, self._start_waits, self._stop_waits):
            for fut in waits.values():
                if not fut.done():
                    fut.set_exception(VmDisconnected("the VM link closed"))
            waits.clear()

    def _wait(self, table: dict[str, asyncio.Future], key: str) -> asyncio.Future:
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        table[key] = fut
        return fut

    async def _await(self, fut: asyncio.Future, timeout: float, what: str) -> dict[str, Any]:
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except TimeoutError:
            raise TimeoutError(
                f"{what} on vm {self.vm_id} timed out after {timeout:.0f} s"
            ) from None

    @staticmethod
    def _resolve(table: dict[str, asyncio.Future], key: str, value: dict[str, Any]) -> None:
        fut = table.pop(key, None)
        if fut is not None and not fut.done():
            fut.set_result(value)


class VmRegistry:
    def __init__(self) -> None:
        self.links: dict[str, VmLink] = {}
        self._waiters: dict[str, list[asyncio.Future]] = {}
        self.on_event: EventHandler | None = None

    def attach(self, link: VmLink) -> None:
        old = self.links.get(link.user_id)
        if old is not None and old is not link:
            old.disconnect()
        self.links[link.user_id] = link
        for fut in self._waiters.pop(link.user_id, []):
            if not fut.done():
                fut.set_result(link)

    def detach(self, link: VmLink) -> None:
        if self.links.get(link.user_id) is link:
            del self.links[link.user_id]
        link.disconnect()

    def get(self, user_id: str) -> VmLink | None:
        link = self.links.get(user_id)
        return link if link is not None and link.alive else None

    async def wait_link(self, user_id: str, timeout: float) -> VmLink:
        link = self.get(user_id)
        if link is not None:
            return link
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._waiters.setdefault(user_id, []).append(fut)
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except TimeoutError:
            raise VmUnavailable(
                f"the VM for {user_id} did not connect within {timeout:.0f} s"
            ) from None
        finally:
            waiters = self._waiters.get(user_id, [])
            if fut in waiters:
                waiters.remove(fut)

    async def dispatch(self, link: VmLink, m: dict[str, Any]) -> None:
        out = link.on_message(m)
        if out is not None and self.on_event is not None:
            await self.on_event(link.user_id, out)


# ------------------------------------------------------------------ #
# controllers
# ------------------------------------------------------------------ #


class VmController(Protocol):
    async def start(self, user_id: str) -> None: ...
    async def stop(self, user_id: str) -> None: ...
    async def status(self, user_id: str) -> str: ...


class LocalVmController:
    """Development: agentd runs on this machine. Nothing to start or stop."""

    def __init__(self) -> None:
        self.started: list[str] = []
        self.stopped: list[str] = []

    async def start(self, user_id: str) -> None:
        self.started.append(user_id)

    async def stop(self, user_id: str) -> None:
        self.stopped.append(user_id)

    async def status(self, user_id: str) -> str:
        return "RUNNING"


def instance_name(user_id: str) -> str:
    """A GCE instance name: lowercase, letters, digits, dashes, 63 chars max."""
    slug = re.sub(r"[^a-z0-9-]", "-", user_id.lower()).strip("-")[:40]
    digest = hashlib.sha256(user_id.encode()).hexdigest()[:8]
    return f"apparatus-{slug}-{digest}" if slug else f"apparatus-{digest}"


class GceVmController:
    """Compute Engine instances, one per user, started and stopped through the REST API.

    The server's own service account (Cloud Run) needs ``compute.instances.start``,
    ``stop`` and ``get`` on the project. The VM's service account needs nothing.
    """

    def __init__(
        self,
        project: str,
        zone: str,
        token_provider: Callable[[], Awaitable[str]],
        client: httpx.AsyncClient | None = None,
    ):
        if not project or not zone:
            raise ValueError("gce controller needs GCE_PROJECT and GCE_ZONE")
        self.base = (
            f"https://compute.googleapis.com/compute/v1/projects/{project}/zones/{zone}/instances"
        )
        self.token_provider = token_provider
        self.client = client or httpx.AsyncClient(timeout=20)

    async def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {await self.token_provider()}"}

    async def start(self, user_id: str) -> None:
        if await self.status(user_id) in ("RUNNING", "STAGING", "PROVISIONING"):
            return
        r = await self.client.post(
            f"{self.base}/{instance_name(user_id)}/start", headers=await self._headers()
        )
        r.raise_for_status()

    async def stop(self, user_id: str) -> None:
        if await self.status(user_id) in ("TERMINATED", "STOPPING"):
            return
        r = await self.client.post(
            f"{self.base}/{instance_name(user_id)}/stop", headers=await self._headers()
        )
        r.raise_for_status()

    async def status(self, user_id: str) -> str:
        r = await self.client.get(
            f"{self.base}/{instance_name(user_id)}", headers=await self._headers()
        )
        if r.status_code == 404:
            return "NOT_FOUND"
        r.raise_for_status()
        return str(r.json().get("status", "UNKNOWN"))


def make_vm_controller(kind: str, project: str, zone: str) -> VmController:
    if kind == "local":
        return LocalVmController()
    if kind == "gce":
        from .push import gce_metadata_token

        return GceVmController(project, zone, gce_metadata_token)
    raise ValueError(f"unknown vm controller {kind!r}")


class IdleStopper:
    """Stop a VM after ``idle_minutes`` with no session, no job and nothing waiting.

    ``busy(user_id)`` says whether a session is open or a job runs or waits.
    ``last_activity(user_id)`` is the time of the last session or job event.
    """

    def __init__(
        self,
        controller: VmController,
        registry: VmRegistry,
        busy: Callable[[str], bool],
        last_activity: Callable[[str], float],
        idle_minutes: float,
        interval_seconds: float = 60,
    ):
        self.controller = controller
        self.registry = registry
        self.busy = busy
        self.last_activity = last_activity
        self.idle_seconds = idle_minutes * 60
        self.interval = interval_seconds
        self.stopped: dict[str, float] = {}
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.ensure_future(self._run())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(self.interval)
            try:
                await self.sweep()
            except Exception:  # noqa: BLE001 - the sweep must survive one bad call
                log.exception("idle sweep failed")

    async def sweep(self, now: float | None = None) -> list[str]:
        now = time.time() if now is None else now
        stopped = []
        for user_id in list(self.registry.links):
            if self.busy(user_id):
                continue
            if now - self.last_activity(user_id) < self.idle_seconds:
                continue
            await self.controller.stop(user_id)
            self.stopped[user_id] = now
            stopped.append(user_id)
            log.info("vm for %s stopped after idle", user_id)
        return stopped
