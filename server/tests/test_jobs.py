"""JobManager against a real in-process agentd core and a scripted model."""

import asyncio
import json
from dataclasses import replace

import pytest

from agentd.config import AgentdConfig
from agentd.core import AgentdCore
from agentd.desktop import FakeBackend
from agentd.libserver import LibServer
from apparatus_protocol import S2C, JobStatus
from apparatus_server.audit import Audit
from apparatus_server.clients import ClientConn, ClientHub
from apparatus_server.jobs import JobManager
from apparatus_server.ledger import InsufficientCredits, Ledger
from apparatus_server.model import FakeSmartModel, FunctionCall, ModelReply, Usage
from apparatus_server.push import LogPush
from apparatus_server.sessions import NaiveSummarizer, Sessions
from apparatus_server.store import MemoryStore
from apparatus_server.vm import LocalVmController, VmLink, VmRegistry

USER = "u1"


class World:
    """A server-side JobManager wired to a real AgentdCore through in-memory sends."""

    def __init__(self, settings, tmp_path, model):
        self.store = MemoryStore()
        self.ledger = Ledger(self.store, settings.credits, settings.prices)
        self.audit = Audit(self.store)
        self.vms = VmRegistry()
        self.clients = ClientHub(self.store)
        self.push = LogPush()
        self.controller = LocalVmController()
        self.sessions = Sessions(self.store, NaiveSummarizer())
        self.jobs = JobManager(
            settings,
            self.store,
            self.ledger,
            self.audit,
            self.vms,
            self.clients,
            model,
            self.push,
            self.controller,
            self.sessions,
            vm_connect_timeout=5,
        )
        cfg = AgentdConfig.from_env(
            {
                "AGENTD_HOME": str(tmp_path / "home"),
                "AGENTD_SOCKET": str(tmp_path / "a.sock"),
                "AGENTD_DESKTOP": "fake",
                "AGENTD_DESKTOP_LOCK_WAIT_SECONDS": "0.2",
                "APPARATUS_VM_ENROLL_SECRET": "",
            }
        )
        self.link = VmLink("vm1", USER, self._to_agentd)
        self.core = AgentdCore(cfg, FakeBackend(), self._to_server)
        self.lib = LibServer(cfg.socket_path, self.core.lib_request)
        self.received: list[dict] = []
        self.conn = ClientConn(user_id=USER, device="web", send=self._to_client)

    async def _to_agentd(self, m):
        asyncio.get_running_loop().call_soon(asyncio.ensure_future, self.core.handle(m))

    async def _to_server(self, m):
        await self.vms.dispatch(self.link, m)

    async def _to_client(self, m):
        self.received.append(m)

    async def start(self):
        await self.lib.start()
        self.vms.attach(self.link)
        self.clients.attach(self.conn)
        await self.clients.claim_voice(self.conn)

    async def stop(self):
        await self.jobs.shutdown()
        await self.core.shutdown()
        await self.lib.stop()

    def messages(self, type_):
        return [m for m in self.received if m["type"] == type_]

    async def wait_done(self, job, limit=15):
        """Until the job ended AND its job.done message reached the client."""

        def announced() -> bool:
            return any(m.get("job_id") == job.job_id for m in self.messages(S2C.JOB_DONE))

        async with asyncio.timeout(limit):
            while job.active or (self.clients.has_session(USER) and not announced()):
                await asyncio.sleep(0.02)
        return job

    async def wait_message(self, type_, limit=5):
        async with asyncio.timeout(limit):
            while not self.messages(type_):
                await asyncio.sleep(0.02)
        return self.messages(type_)[0]


def py(code, call_id="c"):
    return ModelReply(
        calls=[FunctionCall(call_id, "python", {"code": code})], usage=Usage(1000, 50)
    )


def final(status="done", say="All done.", show=None):
    obj = {"status": status, "say": say}
    if show:
        obj["show"] = show
    return ModelReply(text=json.dumps(obj), usage=Usage(500, 40))


@pytest.fixture
async def world_factory(settings, tmp_path):
    worlds = []

    async def make(model, settings_override=None):
        w = World(settings_override or settings, tmp_path, model)
        await w.start()
        worlds.append(w)
        return w

    yield make
    for w in worlds:
        await w.stop()


async def test_job_runs_python_on_the_vm_and_speaks_the_result(world_factory):
    w = await world_factory(
        FakeSmartModel([py("print(6*7)"), final(say="The answer is 42.", show="# 42")])
    )
    job = await w.jobs.start(USER, "multiply six by seven")
    assert w.messages(S2C.JOB_STARTED)[0]["request"] == "multiply six by seven"
    await w.wait_done(job)
    assert job.status == JobStatus.DONE
    assert job.say == "The answer is 42."
    done = w.messages(S2C.JOB_DONE)[0]
    assert done["voice"].endswith("The answer is 42.")
    assert done["show"] == "# 42"
    history = await w.store.get("job_history", job.job_id)
    text = json.dumps(history)
    assert "<<<EXTERNAL_DATA source=vm:python" in text and "42" in text
    acct = await w.ledger.account(USER)
    assert acct["holds"] == {}
    assert acct["balance"] < 500
    kinds = [e["kind"] for e in await w.audit.read(USER)]
    assert "tool.call" in kinds and "job.end" in kinds
    assert job.task_id not in w.core.tasks
    assert w.controller.started == [USER]


async def test_model_without_result_json_gets_one_retry(world_factory):
    w = await world_factory(
        FakeSmartModel([ModelReply(text="I think it is fine."), ModelReply(text="Still prose.")])
    )
    job = await w.jobs.start(USER, "x")
    await w.wait_done(job)
    assert job.status == JobStatus.DONE
    assert job.say == "Still prose."


async def test_two_jobs_run_in_parallel(world_factory):
    def script(history):
        last = json.dumps(history[-1])
        if "Job:" in last:
            return py("import time; time.sleep(0.4); print('slow')")
        return final(say="Done.")

    w = await world_factory(FakeSmartModel(script))
    j1 = await w.jobs.start(USER, "one")
    j2 = await w.jobs.start(USER, "two")
    t0 = asyncio.get_running_loop().time()
    await asyncio.gather(w.wait_done(j1), w.wait_done(j2))
    elapsed = asyncio.get_running_loop().time() - t0
    assert j1.status == j2.status == JobStatus.DONE
    assert elapsed < 0.75, f"jobs ran serially: {elapsed:.2f}s"


async def test_check_and_cancel(world_factory):
    w = await world_factory(FakeSmartModel(lambda h: py("import time; time.sleep(5)")))
    job = await w.jobs.start(USER, "long")
    await asyncio.sleep(0.3)
    assert w.jobs.check(USER, job.job_id)["status"] == JobStatus.RUNNING
    assert w.jobs.check(USER, "nope") == {"error": "unknown job"}
    r = await w.jobs.cancel(USER, job.job_id)
    assert r["ok"]
    await w.wait_done(job)
    assert job.status == JobStatus.CANCELLED
    assert w.jobs.check(USER, job.job_id)["status"] == JobStatus.CANCELLED
    assert w.messages(S2C.JOB_DONE)[-1].get("voice") is None


async def test_step_budget_ends_the_job(world_factory, settings):
    small = replace(settings, jobs=replace(settings.jobs, max_steps=3))
    w = await world_factory(FakeSmartModel(lambda h: py("1")), small)
    job = await w.jobs.start(USER, "loop forever")
    await w.wait_done(job)
    assert job.status == JobStatus.FAILED
    assert "steps" in job.say
    assert job.steps == 3


async def test_handoff_tool_pauses_task_until_done(world_factory):
    replies = [
        ModelReply(
            calls=[FunctionCall("h", "handoff", {"reason": "login page", "url": "https://x"})]
        ),
        py("print('after')"),
        final(say="Logged in and finished."),
    ]
    w = await world_factory(FakeSmartModel(replies))
    job = await w.jobs.start(USER, "needs login")
    req = await w.wait_message(S2C.HANDOFF_REQUESTED)
    assert req["reason"] == "login page" and "take over" in req["voice"]
    assert job.status == JobStatus.PAUSED and job.paused_for == "handoff"
    await asyncio.sleep(0.05)
    assert w.core.handoff_active is True
    assert await w.jobs.end_handoff(req["handoff_id"], "done", USER)
    await w.wait_done(job)
    assert job.status == JobStatus.DONE
    assert w.messages(S2C.HANDOFF_ENDED)[0]["outcome"] == "done"
    assert w.core.handoff_active is False
    assert not await w.jobs.end_handoff("nope", "done", USER)


async def test_agentlib_approval_from_inside_python(world_factory):
    code = "import agentlib\nok = agentlib.request_approval('send', {'to': 'a@b'})\nprint('SENT' if ok else 'HELD')"
    w = await world_factory(FakeSmartModel([py(code), final(say="Sent it.")]))
    job = await w.jobs.start(USER, "send mail")
    req = await w.wait_message(S2C.APPROVAL_REQUESTED)
    assert req["action"] == "send" and "approval" in req["voice"]
    assert job.paused_for == "approval"
    assert w.jobs.answer_approval(USER, req["approval_id"], True)
    await w.wait_done(job)
    assert job.status == JobStatus.DONE
    history = json.dumps(await w.store.get("job_history", job.job_id))
    assert "SENT" in history
    kinds = [e["kind"] for e in await w.audit.read(USER)]
    assert "approval.request" in kinds and "approval.answer" in kinds


async def test_push_carries_kind_and_type_when_no_client_has_a_session(world_factory):
    w = await world_factory(FakeSmartModel([final(say="Finished while you were away.")]))
    await w.clients.register_push(USER, w.conn.device_id, "fcm", "tok-1")
    w.clients.detach(w.conn)  # no open session: the server must push
    job = await w.jobs.start(USER, "x")
    await w.wait_done(job)
    assert w.push.sent, "no push was sent"
    data = w.push.sent[-1]["data"]
    assert (
        data["kind"] == "job.done" and data["type"] == "job.done" and data["job_id"] == job.job_id
    )


async def test_agentlib_say_and_progress_reach_the_feed(world_factory):
    code = "import agentlib\nagentlib.say('half way')\nagentlib.progress('page 2', percent=50)"
    w = await world_factory(FakeSmartModel([py(code), final()]))
    job = await w.jobs.start(USER, "x")
    await w.wait_done(job)
    progress = w.messages(S2C.JOB_PROGRESS)
    assert any(p.get("voice") == "say: half way" for p in progress)
    assert any(p.get("percent") == 50 for p in progress)


async def test_no_credits_blocks_start(world_factory):
    w = await world_factory(FakeSmartModel([final()]))
    acct = await w.ledger.account(USER)
    acct["balance"] = 0
    await w.store.put("ledger", USER, acct)
    with pytest.raises(InsufficientCredits):
        await w.jobs.start(USER, "anything")


async def test_job_pauses_when_credits_run_out_and_resumes_on_grant(world_factory, settings):
    tight = replace(
        settings,
        credits=replace(settings.credits, trial_grant=200, job_hold=10, daily_cap=100000),
        jobs=replace(settings.jobs, max_tokens=10_000_000),
    )
    expensive = ModelReply(
        calls=[FunctionCall("c", "python", {"code": "1"})], usage=Usage(1_000_000, 0)
    )
    w = await world_factory(FakeSmartModel([expensive, expensive, final()]), tight)
    job = await w.jobs.start(USER, "x")
    async with asyncio.timeout(5):
        while job.paused_for != "credits":
            await asyncio.sleep(0.02)
    assert job.status == JobStatus.PAUSED
    assert any(m.get("state") == "out" for m in w.messages(S2C.CREDITS))
    await w.ledger.grant(USER, 5000, "topup")
    w.jobs.resume_for_credits(USER)
    await w.wait_done(job)
    assert job.status == JobStatus.DONE


async def test_vm_never_connecting_fails_the_job_cleanly(settings, tmp_path):
    w = World(settings, tmp_path, FakeSmartModel([final()]))
    w.jobs.vm_connect_timeout = 0.2
    await w.lib.start()
    w.clients.attach(w.conn)
    try:
        job = await w.jobs.start(USER, "x")
        await w.wait_done(job)
        assert job.status == JobStatus.FAILED
        assert "did not start" in job.say
        assert (await w.ledger.account(USER))["holds"] == {}
    finally:
        await w.stop()


async def test_computer_is_refused_on_the_server_while_a_handoff_is_open(world_factory):
    """A second job cannot capture the screen while the first waits in a handoff."""

    def script(history):
        last = json.dumps(history[-1])
        if "Job: first" in last:
            return ModelReply(
                calls=[FunctionCall("h", "handoff", {"reason": "login", "url": "https://x"})]
            )
        if "Job: second" in last:
            return ModelReply(calls=[FunctionCall("c", "computer", {"action": "screenshot"})])
        return final(say="Done.")

    w = await world_factory(FakeSmartModel(script))
    first = await w.jobs.start(USER, "first")
    req = await w.wait_message(S2C.HANDOFF_REQUESTED)
    second = await w.jobs.start(USER, "second")
    await w.wait_done(second)
    history = json.dumps(await w.store.get("job_history", second.job_id))
    assert "handoff_active" in history and "inline_data" not in history
    assert w.core.handoff_active is True
    await w.jobs.end_handoff(req["handoff_id"], "done", USER)
    await w.wait_done(first)
    assert first.status == JobStatus.DONE
