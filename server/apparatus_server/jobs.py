"""Jobs: start, check, cancel; handoffs; approvals; the smart-model loop.

A job is one request from the voice model. It gets a task on the user's VM,
a hold on the user's credits and a budget of steps, tokens and wall time.
The loop runs on this server. Each python or computer call goes to agentd.
The job ends with the result contract, which the voice model speaks.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any

from apparatus_protocol import (
    S2C,
    CreditsState,
    EventKind,
    HandoffOutcome,
    JobResult,
    JobStatus,
    extract_result,
    msg,
    wrap_external,
)

from .audit import Audit
from .clients import ClientHub
from .config import Settings
from .ledger import DailyCapReached, InsufficientCredits, Ledger
from .model import FunctionCall, ModelReply, SmartModel
from .push import Push
from .sessions import Sessions
from .smart import SMART_SYSTEM_PROMPT, first_user_message, smart_tool_declarations
from .store import Store
from .vm import VmController, VmDisconnected, VmLink, VmRegistry, VmUnavailable

log = logging.getLogger("apparatus.jobs")
JOBS = "jobs"
HISTORY = "job_history"
PUSH_TYPE_BY_KIND = {
    "handoff": S2C.HANDOFF_REQUESTED,
    "approval": S2C.APPROVAL_REQUESTED,
    "job.done": S2C.JOB_DONE,
    "credits": S2C.CREDITS,
}
PROGRESS_HISTORY_MAX = 50
STEP_LINE_MAX = 80


@dataclass
class Job:
    job_id: str
    user_id: str
    request: str
    context: str | None = None
    status: str = JobStatus.QUEUED
    task_id: str = ""
    model: str = ""
    created: float = field(default_factory=time.time)
    started: float | None = None
    ended: float | None = None
    steps: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0
    credits_used: int = 0
    hold: int = 0
    progress: str = ""
    percent: float | None = None
    progress_history: list[str] = field(default_factory=list)
    say: str = ""
    show: str | None = None
    artifacts: list[str] = field(default_factory=list)
    paused_for: str | None = None  # handoff | approval | credits
    cancel_requested: bool = False
    error: str | None = None

    def public(self) -> dict[str, Any]:
        d = asdict(self)
        d.pop("cancel_requested", None)
        return d

    @property
    def active(self) -> bool:
        return self.status in (JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.PAUSED)

    def note_progress(self, text: str) -> None:
        self.progress_history.append(text)
        del self.progress_history[:-PROGRESS_HISTORY_MAX]


@dataclass
class Handoff:
    handoff_id: str
    job_id: str
    user_id: str
    task_id: str
    reason: str
    url: str | None
    from_agentlib: bool
    future: asyncio.Future
    created: float = field(default_factory=time.time)


@dataclass
class Approval:
    approval_id: str
    job_id: str
    user_id: str
    task_id: str
    action: str
    details: Any
    future: asyncio.Future
    created: float = field(default_factory=time.time)


class JobManager:
    def __init__(
        self,
        settings: Settings,
        store: Store,
        ledger: Ledger,
        audit: Audit,
        vms: VmRegistry,
        clients: ClientHub,
        model: SmartModel,
        push: Push,
        vm_controller: VmController,
        sessions: Sessions,
        vm_connect_timeout: float = 180,
    ):
        self.s = settings
        self.store = store
        self.ledger = ledger
        self.audit = audit
        self.vms = vms
        self.clients = clients
        self.model = model
        self.push = push
        self.vm_controller = vm_controller
        self.sessions = sessions
        self.vm_connect_timeout = vm_connect_timeout
        self.jobs: dict[str, Job] = {}
        self.handoffs: dict[str, Handoff] = {}
        self.approvals: dict[str, Approval] = {}
        self._runners: dict[str, asyncio.Task] = {}
        self._credit_waits: dict[str, asyncio.Event] = {}
        self.last_activity: dict[str, float] = {}
        vms.on_event = self.on_vm_event

    # ------------------------------------------------------------------ #
    # voice-model tools
    # ------------------------------------------------------------------ #

    async def start(self, user_id: str, request: str, context: str | None = None) -> Job:
        request = (request or "").strip()
        if not request:
            raise ValueError("start_job needs a request")
        job = Job(
            job_id=uuid.uuid4().hex[:12], user_id=user_id, request=request, context=context or None
        )
        job.task_id = job.job_id
        job.model = self._pick_model(context)
        job.hold = await self.ledger.hold(user_id, job.job_id)  # raises when credits are out
        self.jobs[job.job_id] = job
        await self._save(job)
        await self.audit.record(
            user_id, "job.start", job_id=job.job_id, request=request, context=context
        )
        self.touch(user_id)
        await self.vm_controller.start(user_id)
        await self.clients.broadcast(
            user_id, msg(S2C.JOB_STARTED, job_id=job.job_id, request=request)
        )
        self._runners[job.job_id] = asyncio.ensure_future(self._run(job))
        return job

    def _pick_model(self, context: str | None) -> str:
        if context and "model=pro" in context:
            return self.s.models.smart_upgrade
        return (
            self.s.models.smart_upgrade if self.s.models.smart_use_upgrade else self.s.models.smart
        )

    def check(self, user_id: str, job_id: str) -> dict[str, Any]:
        job = self.jobs.get(job_id)
        if job is None or job.user_id != user_id:
            return {"error": "unknown job"}
        out: dict[str, Any] = {"job_id": job.job_id, "status": job.status, "steps": job.steps}
        if job.progress:
            out["progress"] = job.progress
        if job.paused_for:
            out["waiting_on"] = job.paused_for
        if job.status in JobStatus.TERMINAL:
            out["say"] = job.say
        return out

    async def cancel(self, user_id: str, job_id: str) -> dict[str, Any]:
        job = self.jobs.get(job_id)
        if job is None or job.user_id != user_id:
            return {"ok": False, "error": "unknown job"}
        if not job.active:
            return {"ok": True, "status": job.status}
        job.cancel_requested = True
        for h in list(self.handoffs.values()):
            if h.job_id == job_id:
                await self.end_handoff(h.handoff_id, HandoffOutcome.CANCEL)
        for a in list(self.approvals.values()):
            if a.job_id == job_id and not a.future.done():
                a.future.set_result(False)
        self._credit_waits.get(job_id, asyncio.Event()).set()
        runner = self._runners.get(job_id)
        if runner is not None and not runner.done():
            runner.cancel()
        await self.audit.record(user_id, "job.cancel", job_id=job_id)
        return {"ok": True, "status": JobStatus.CANCELLED}

    def active_jobs(self, user_id: str) -> list[Job]:
        return [j for j in self.jobs.values() if j.user_id == user_id and j.active]

    def is_busy(self, user_id: str) -> bool:
        return bool(self.active_jobs(user_id)) or self.clients.has_session(user_id)

    def last_activity_at(self, user_id: str) -> float:
        return max(
            self.last_activity.get(user_id, 0.0), self.clients.last_activity.get(user_id, 0.0)
        )

    def touch(self, user_id: str) -> None:
        self.last_activity[user_id] = time.time()

    # ------------------------------------------------------------------ #
    # the loop
    # ------------------------------------------------------------------ #

    async def _run(self, job: Job) -> None:
        link: VmLink | None = None
        try:
            link = await self.vms.wait_link(job.user_id, self.vm_connect_timeout)
            started = await link.start_task(
                job.task_id,
                job.job_id,
                job.request,
                {"wall_seconds": self.s.jobs.max_wall_seconds, "steps": self.s.jobs.max_steps},
            )
            job.status = JobStatus.RUNNING
            job.started = time.time()
            await self._save(job)
            history = [
                {
                    "role": "user",
                    "parts": [
                        {
                            "text": first_user_message(
                                job.request,
                                job.context,
                                started.get("memory_index", ""),
                                started.get("tools_index", ""),
                                job.task_id,
                            )
                        }
                    ],
                }
            ]
            result = await self._loop(job, link, history)
        except asyncio.CancelledError:
            result = JobResult(status="failed", say="I stopped that job.")
            job.status = JobStatus.CANCELLED
        except VmUnavailable as e:
            log.warning("job %s: %s", job.job_id, e)
            result = JobResult.failed(
                "Your computer did not start in time. I will try again when you ask."
            )
        except (TimeoutError, VmDisconnected) as e:
            log.warning("job %s: %s", job.job_id, e)
            result = JobResult.failed(
                "I lost the connection to your computer before the job finished."
            )
        except Exception as e:  # noqa: BLE001 - a job must always end with a result
            log.exception("job %s crashed", job.job_id)
            job.error = f"{type(e).__name__}: {e}"
            result = JobResult.failed(
                "Something broke while I worked on that. The details are on the screen."
            )
            result.show = f"```\n{job.error}\n```"
        await self._finish(job, result, link)

    async def _loop(self, job: Job, link: VmLink, history: list[dict[str, Any]]) -> JobResult:
        tools = smart_tool_declarations()
        asked_for_json = False
        while True:
            if job.cancel_requested:
                job.status = JobStatus.CANCELLED
                return JobResult(status="failed", say="I stopped that job.")
            over = self._over_budget(job)
            if over:
                return JobResult.failed(f"I stopped the job: {over}.")
            reply = await self.model.generate(
                model=job.model, system=SMART_SYSTEM_PROMPT, history=history, tools=tools
            )
            job.steps += 1
            await self._meter(job, reply)
            history.append(reply.as_content())
            if reply.calls:
                parts = []
                for call in reply.calls:
                    parts.extend(await self._tool(job, link, call))
                history.append({"role": "user", "parts": parts})
                history = await self._compact(job, history)
                await self._checkpoint(job, history)
                continue
            result = extract_result(reply.text)
            if result is not None:
                return result
            if asked_for_json:
                say = (
                    reply.text.strip().replace("\n", " ")[:300]
                    or "I finished, but I could not form a result."
                )
                return JobResult(status="done", say=say)
            asked_for_json = True
            history.append(
                {
                    "role": "user",
                    "parts": [
                        {"text": "Reply with the result JSON object only, as the instructions say."}
                    ],
                }
            )

    def _over_budget(self, job: Job) -> str | None:
        if job.steps >= self.s.jobs.max_steps:
            return f"it used all {self.s.jobs.max_steps} steps"
        if job.input_tokens + job.output_tokens >= self.s.jobs.max_tokens:
            return "it used its token budget"
        if job.started and time.time() - job.started >= self.s.jobs.max_wall_seconds:
            return "it ran out of time"
        return None

    async def _meter(self, job: Job, reply: ModelReply) -> None:
        u = reply.usage
        job.input_tokens += u.input_tokens
        job.output_tokens += u.output_tokens
        job.cached_tokens += u.cached_tokens
        upgrade = job.model == self.s.models.smart_upgrade
        credits = self.ledger.price_smart(
            u.input_tokens, u.output_tokens, u.cached_tokens, upgrade=upgrade
        )
        job.credits_used += credits
        # Over the hold? Charge as we go and pause when the balance is gone.
        if job.credits_used > job.hold:
            try:
                await self.ledger.charge(job.user_id, credits, "job_step", job_id=job.job_id)
            except (InsufficientCredits, DailyCapReached) as e:
                await self._pause_for_credits(job, str(e))

    async def _pause_for_credits(self, job: Job, reason: str) -> None:
        job.status = JobStatus.PAUSED
        job.paused_for = "credits"
        await self._save(job)
        await self.audit.record(job.user_id, "job.pause", job_id=job.job_id, reason=reason)
        await self.notify_credits(job.user_id)
        event = self._credit_waits.setdefault(job.job_id, asyncio.Event())
        await event.wait()  # cleared by a grant or a cancel
        self._credit_waits.pop(job.job_id, None)
        job.status = JobStatus.RUNNING
        job.paused_for = None

    def resume_for_credits(self, user_id: str) -> None:
        for job in self.active_jobs(user_id):
            if job.paused_for == "credits":
                self._credit_waits.get(job.job_id, asyncio.Event()).set()

    async def _tool(self, job: Job, link: VmLink, call: FunctionCall) -> list[dict[str, Any]]:
        """Run one smart-model tool call. Returns the parts for the function response."""
        self.touch(job.user_id)
        await self.audit.record(
            job.user_id, "tool.call", job_id=job.job_id, tool=call.name, args=call.args
        )
        parts: list[dict[str, Any]] = []
        response: dict[str, Any]
        if call.name == "computer" and self.handoff_active_for(job.user_id):
            # Belt to agentd's own refusal: nothing captures the screen during a handoff.
            response = {
                "ok": False,
                "error": "handoff_active: the user controls the screen; no screenshots",
            }
        elif call.name in ("python", "computer"):
            timeout = (
                self.s.jobs.python_timeout_seconds
                + 60
                + (self.s.jobs.handoff_wait_minutes + self.s.jobs.approval_wait_minutes) * 60
            )
            r = await link.call_tool(job.task_id, call.name, call.args, timeout=timeout)
            response = {"ok": bool(r.get("ok"))}
            if r.get("output"):
                response["output"] = wrap_external(str(r["output"]), f"vm:{call.name}")
            if r.get("error"):
                response["error"] = wrap_external(str(r["error"]), f"vm:{call.name}")
            if r.get("files"):
                response["files"] = r["files"]
            if r.get("image_b64") and not self.handoff_active_for(job.user_id):
                parts.append({"inline_data": {"mime_type": "image/png", "data": r["image_b64"]}})
            elif r.get("image_b64"):
                response["error"] = "handoff_active: the screenshot was dropped; a handoff began"
        elif call.name == "show":
            content = str(call.args.get("content", ""))
            await self.clients.broadcast(
                job.user_id,
                msg(S2C.SHOW, content=content, target=call.args.get("target"), job_id=job.job_id),
            )
            job.show = content
            response = {"ok": True}
        elif call.name == "handoff":
            outcome = await self.start_handoff(
                job, str(call.args.get("reason", "")), call.args.get("url"), from_agentlib=False
            )
            response = {"ok": True, "outcome": outcome}
        else:
            response = {"ok": False, "error": f"unknown tool {call.name}"}
        await self.audit.record(
            job.user_id, "tool.result", job_id=job.job_id, tool=call.name, ok=response.get("ok")
        )
        parts.insert(
            0, {"function_response": {"id": call.id, "name": call.name, "response": response}}
        )
        step = step_summary(call)
        job.note_progress(step)
        await self.clients.broadcast(
            job.user_id, msg(S2C.JOB_PROGRESS, job_id=job.job_id, text=step)
        )
        return parts

    async def _compact(self, job: Job, history: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Replace old steps with a short summary when the context passes the size limit."""
        size = len(json.dumps(history))
        if size <= self.s.jobs.context_summary_chars:
            return history
        keep = self.s.jobs.context_keep_steps * 2  # a model turn and its tool responses
        head, tail = history[:1], history[-keep:] if keep < len(history) - 1 else history[1:]
        old = history[1 : len(history) - len(tail)]
        if not old:
            return history
        summary_prompt = (
            "Summarize these earlier steps of your own work in under 1500 characters: "
            "what you tried, what worked, what you learned, and the exact names of files and variables you created.\n\n"
            + json.dumps(old)[: self.s.jobs.context_summary_chars]
        )
        try:
            reply = await self.model.generate(
                model=job.model,
                system="You write short, exact summaries.",
                history=[{"role": "user", "parts": [{"text": summary_prompt}]}],
                tools=[],
            )
            await self._meter(job, reply)
            summary = reply.text.strip() or "(summary unavailable)"
        except Exception as e:  # noqa: BLE001
            summary = f"(summary unavailable: {e})"
        await self.audit.record(
            job.user_id, "job.compact", job_id=job.job_id, dropped=len(old), size=size
        )
        return (
            head
            + [{"role": "user", "parts": [{"text": f"Summary of your earlier steps:\n{summary}"}]}]
            + tail
        )

    async def _checkpoint(self, job: Job, history: list[dict[str, Any]]) -> None:
        await self._save(job)
        await self.store.put(
            HISTORY, job.job_id, {"job_id": job.job_id, "history": history, "t": time.time()}
        )

    async def _save(self, job: Job) -> None:
        await self.store.put(JOBS, job.job_id, job.public())

    async def _finish(self, job: Job, result: JobResult, link: VmLink | None) -> None:
        if job.status != JobStatus.CANCELLED:
            job.status = {
                "done": JobStatus.DONE,
                "failed": JobStatus.FAILED,
                "needs_user": JobStatus.NEEDS_USER,
            }[result.status]
        job.say, job.show, job.artifacts = result.say, result.show or job.show, result.artifacts
        job.ended = time.time()
        job.paused_for = None
        self._runners.pop(job.job_id, None)
        if link is not None and link.alive:
            try:
                await link.stop_task(job.task_id, job.status, result.to_dict())
            except Exception as e:  # noqa: BLE001
                log.warning("stop_task %s: %s", job.task_id, e)
        balance = await self.ledger.settle(
            job.user_id,
            job.job_id,
            job.credits_used if job.credits_used <= job.hold else 0,
            tokens_in=job.input_tokens,
            tokens_out=job.output_tokens,
        )
        await self._save(job)
        await self.audit.record(
            job.user_id,
            "job.end",
            job_id=job.job_id,
            status=job.status,
            steps=job.steps,
            tokens_in=job.input_tokens,
            tokens_out=job.output_tokens,
            credits=job.credits_used,
            balance=balance,
        )
        await self.sessions.note_event(job.user_id, f"job {job.job_id} {job.status}: {job.say}")
        voice = None if job.status == JobStatus.CANCELLED else f"job.done {job.job_id}: {job.say}"
        await self.clients.broadcast(
            job.user_id,
            msg(
                S2C.JOB_DONE,
                job_id=job.job_id,
                status=job.status,
                say=job.say,
                show=job.show,
                artifacts=job.artifacts,
                voice=voice,
            ),
        )
        if not self.clients.has_session(job.user_id):
            await self._push(
                job.user_id, "Done", job.say, {"kind": "job.done", "job_id": job.job_id}
            )
        self.touch(job.user_id)
        await self.notify_credits(job.user_id)

    # ------------------------------------------------------------------ #
    # events from the VM (agentlib)
    # ------------------------------------------------------------------ #

    async def on_vm_event(self, user_id: str, m: dict[str, Any]) -> None:
        if m["type"] != "event":
            return  # stream signals are routed to the owning device by the socket layer
        job = self._job_for_task(user_id, m["task_id"])
        if job is None:
            return
        kind, payload, request_id = m["kind"], m["payload"], m.get("request_id")
        self.touch(user_id)
        if kind == EventKind.SAY:
            text = str(payload.get("text", "")).strip()
            await self.clients.broadcast(
                user_id, msg(S2C.JOB_PROGRESS, job_id=job.job_id, text=text, voice=f"say: {text}")
            )
        elif kind == EventKind.PROGRESS:
            job.progress = str(payload.get("text", ""))
            job.percent = payload.get("percent")
            job.note_progress(job.progress)
            await self.clients.broadcast(
                user_id,
                msg(S2C.JOB_PROGRESS, job_id=job.job_id, text=job.progress, percent=job.percent),
            )
        elif kind == EventKind.SHOW:
            await self.clients.broadcast(
                user_id,
                msg(
                    S2C.SHOW,
                    content=str(payload.get("content", "")),
                    target=payload.get("target"),
                    job_id=job.job_id,
                ),
            )
        elif kind == EventKind.HANDOFF_REQUEST and request_id:
            asyncio.ensure_future(
                self.start_handoff(
                    job,
                    str(payload.get("reason", "")),
                    payload.get("url"),
                    from_agentlib=True,
                    handoff_id=request_id,
                )
            )
        elif kind == EventKind.APPROVAL_REQUEST and request_id:
            asyncio.ensure_future(
                self.start_approval(
                    job, request_id, str(payload.get("action", "")), payload.get("details")
                )
            )
        elif kind == EventKind.API_REQUEST and request_id:
            link = self.vms.get(user_id)
            if link is not None:
                await link.api_result(
                    job.task_id, request_id, ok=False, error="no connected services in version 1"
                )

    def handoff_active_for(self, user_id: str) -> bool:
        return any(h.user_id == user_id for h in self.handoffs.values())

    def _job_for_task(self, user_id: str, task_id: str) -> Job | None:
        for job in self.jobs.values():
            if job.user_id == user_id and job.task_id == task_id and job.active:
                return job
        return None

    # ------------------------------------------------------------------ #
    # handoff
    # ------------------------------------------------------------------ #

    async def start_handoff(
        self,
        job: Job,
        reason: str,
        url: str | None,
        *,
        from_agentlib: bool,
        handoff_id: str | None = None,
    ) -> str:
        """Pause the task, tell the user, wait for Done or Cancel. Returns the outcome."""
        handoff_id = handoff_id or uuid.uuid4().hex[:12]
        link = self.vms.get(job.user_id)
        if link is None:
            return HandoffOutcome.CANCEL
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        h = Handoff(
            handoff_id, job.job_id, job.user_id, job.task_id, reason, url, from_agentlib, fut
        )
        self.handoffs[handoff_id] = h
        job.status = JobStatus.PAUSED
        job.paused_for = "handoff"
        await self._save(job)
        if not from_agentlib:
            await link.pause_task(job.task_id, handoff_id, reason)
        await self.audit.record(
            job.user_id,
            "handoff.start",
            job_id=job.job_id,
            handoff_id=handoff_id,
            reason=reason,
            url=url,
        )
        voice = f"handoff: I need you to take over the screen: {reason}"
        await self.clients.broadcast(
            job.user_id,
            msg(
                S2C.HANDOFF_REQUESTED,
                handoff_id=handoff_id,
                job_id=job.job_id,
                reason=reason,
                url=url,
                voice=voice,
            ),
        )
        await self._push(
            job.user_id,
            "Your turn",
            reason,
            {"kind": "handoff", "handoff_id": handoff_id, "job_id": job.job_id},
        )
        try:
            outcome = await asyncio.wait_for(fut, timeout=self.s.jobs.handoff_wait_minutes * 60)
        except TimeoutError:
            outcome = HandoffOutcome.TIMEOUT
            await self._end_handoff_inner(h, outcome)
        return outcome

    async def end_handoff(self, handoff_id: str, outcome: str, user_id: str | None = None) -> bool:
        h = self.handoffs.get(handoff_id)
        if h is None or (user_id is not None and h.user_id != user_id):
            return False
        await self._end_handoff_inner(h, outcome)
        return True

    async def _end_handoff_inner(self, h: Handoff, outcome: str) -> None:
        self.handoffs.pop(h.handoff_id, None)
        job = self.jobs.get(h.job_id)
        link = self.vms.get(h.user_id)
        if link is not None:
            await link.resume_handoff(h.task_id, h.handoff_id, outcome)
        if job is not None and job.paused_for == "handoff":
            job.status = JobStatus.RUNNING
            job.paused_for = None
            await self._save(job)
        await self.audit.record(
            h.user_id, "handoff.end", job_id=h.job_id, handoff_id=h.handoff_id, outcome=outcome
        )
        await self.clients.broadcast(
            h.user_id, msg(S2C.HANDOFF_ENDED, handoff_id=h.handoff_id, outcome=outcome)
        )
        if not h.future.done():
            h.future.set_result(outcome)

    # ------------------------------------------------------------------ #
    # approvals
    # ------------------------------------------------------------------ #

    async def start_approval(self, job: Job, approval_id: str, action: str, details: Any) -> None:
        link = self.vms.get(job.user_id)
        if link is None:
            return
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        a = Approval(approval_id, job.job_id, job.user_id, job.task_id, action, details, fut)
        self.approvals[approval_id] = a
        job.status = JobStatus.PAUSED
        job.paused_for = "approval"
        await self._save(job)
        await self.audit.record(
            job.user_id,
            "approval.request",
            job_id=job.job_id,
            approval_id=approval_id,
            action=action,
            details=details,
        )
        summary = _details_summary(details)
        voice = f"approval: the job wants to {action}. {summary} Approve or deny on your screen."
        await self.clients.broadcast(
            job.user_id,
            msg(
                S2C.APPROVAL_REQUESTED,
                approval_id=approval_id,
                job_id=job.job_id,
                action=action,
                details=details,
                voice=voice,
            ),
        )
        await self._push(
            job.user_id,
            f"Approve: {action}?",
            summary,
            {"kind": "approval", "approval_id": approval_id, "job_id": job.job_id},
        )
        try:
            approved = await asyncio.wait_for(fut, timeout=self.s.jobs.approval_wait_minutes * 60)
        except TimeoutError:
            approved = False
        self.approvals.pop(approval_id, None)
        await self.audit.record(
            job.user_id,
            "approval.answer",
            job_id=job.job_id,
            approval_id=approval_id,
            approved=approved,
        )
        if job.paused_for == "approval":
            job.status = JobStatus.RUNNING
            job.paused_for = None
            await self._save(job)
        await self.clients.broadcast(
            job.user_id, msg(S2C.APPROVAL_ENDED, approval_id=approval_id, approved=approved)
        )
        link = self.vms.get(job.user_id)
        if link is not None:
            await link.answer_approval(job.task_id, approval_id, approved)

    def answer_approval(self, user_id: str, approval_id: str, approved: bool) -> bool:
        a = self.approvals.get(approval_id)
        if a is None or a.user_id != user_id or a.future.done():
            return False
        a.future.set_result(bool(approved))
        return True

    # ------------------------------------------------------------------ #
    # credits
    # ------------------------------------------------------------------ #

    async def notify_credits(self, user_id: str) -> None:
        balance, state = await self.ledger.state(user_id)
        voice = None
        if state in (CreditsState.LOW, CreditsState.OUT) and await self.ledger.warn_once(
            user_id, state
        ):
            voice = (
                "credits: you have about 20 percent of your credits left."
                if state == CreditsState.LOW
                else "credits: your credits are used up. Running jobs paused."
            )
            if state == CreditsState.OUT:
                await self._push(
                    user_id,
                    "Credits used up",
                    "Jobs paused. Top up to continue.",
                    {"kind": "credits"},
                )
        await self.clients.broadcast(
            user_id, msg(S2C.CREDITS, balance=balance, state=state, voice=voice)
        )

    async def _push(self, user_id: str, title: str, body: str, data: dict[str, str]) -> None:
        # ``kind`` is the short name; ``type`` is the matching S2C message type,
        # so a native client can key on either.
        data = {**data, "type": PUSH_TYPE_BY_KIND.get(data.get("kind", ""), data.get("kind", ""))}
        tokens = await self.clients.push_tokens(user_id)
        if tokens:
            try:
                await self.push.send(tokens, title, body[:200], data)
            except Exception as e:  # noqa: BLE001
                log.warning("push failed: %s", e)

    async def shutdown(self) -> None:
        for task in list(self._runners.values()):
            task.cancel()
        await asyncio.gather(*self._runners.values(), return_exceptions=True)


def step_summary(call: FunctionCall) -> str:
    """One short line for the feed after a tool step. Never spoken."""
    args = call.args or {}
    if call.name == "python":
        code = str(args.get("code", ""))
        line = next((ln.strip() for ln in code.splitlines() if ln.strip()), "")
        return f"python: {line[:STEP_LINE_MAX]}"
    if call.name == "computer":
        text = f"computer: {args.get('action', '')}"
        if args.get("x") is not None and args.get("y") is not None:
            text += f" [{args['x']},{args['y']}]"
        return text
    if call.name == "handoff":
        return f"handoff: {args.get('reason', '')}"
    return call.name


def _details_summary(details: Any, limit: int = 160) -> str:
    if details is None:
        return ""
    text = details if isinstance(details, str) else json.dumps(details, ensure_ascii=False)
    return text[:limit]
