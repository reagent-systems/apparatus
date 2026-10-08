import asyncio
import base64
import json

import pytest

from agentd import disk
from agentd.core import AgentdCore
from agentd.desktop import FakeBackend
from agentd.libserver import LibServer
from apparatus_protocol import A2S, S2A, EventKind, msg


class Harness:
    def __init__(self, cfg):
        self.sent: list[dict] = []
        self.backend = FakeBackend()
        self.core = AgentdCore(cfg, self.backend, self._send)
        self.lib = LibServer(cfg.socket_path, self.core.lib_request)
        self.cfg = cfg

    async def _send(self, m):
        self.sent.append(m)

    async def start_task(self, task_id="t1", **budget):
        await self.core.handle(
            msg(
                S2A.TASK_START,
                task_id=task_id,
                job_id="j1",
                request="do a thing",
                budget={"wall_seconds": 60, "steps": 5, **budget},
            )
        )
        return self.last(A2S.TASK_STARTED)

    async def call(self, task_id, name, call_id="c1", **args):
        await self.core.handle(
            msg(S2A.TOOL_CALL, id=call_id, task_id=task_id, name=name, args=args)
        )
        # Tool execution runs detached from the message pump.
        return await self.wait_for(A2S.TOOL_RESULT, limit=30, id=call_id)

    def last(self, type_, **match):
        for m in reversed(self.sent):
            if m["type"] == type_ and all(m.get(k) == v for k, v in match.items()):
                return m
        raise AssertionError(f"no {type_} {match} in {self.sent}")

    async def wait_for(self, type_, limit=5, **match):
        async with asyncio.timeout(limit):
            while True:
                try:
                    return self.last(type_, **match)
                except AssertionError:
                    await asyncio.sleep(0.02)


@pytest.fixture
async def h(cfg):
    harness = Harness(cfg)
    await harness.lib.start()
    yield harness
    await harness.core.shutdown()
    await harness.lib.stop()


async def test_task_start_creates_layout_and_returns_indices(h, cfg):
    started = await h.start_task()
    assert started["restored"] is False
    assert "Memory index" in started["memory_index"]
    assert "Saved tools" in started["tools_index"]
    assert disk.task_dir(cfg.home, "t1").is_dir()
    assert disk.browser_profile(cfg.home).is_dir()


async def test_python_tool_runs_and_logs(h, cfg):
    await h.start_task()
    r = await h.call("t1", "python", code="print(2+2)")
    assert r["ok"] and r["output"].strip() == "4"
    entries = [
        json.loads(line)
        for line in (disk.task_dir(cfg.home, "t1") / "log.jsonl").read_text().splitlines()
    ]
    kinds = [e["kind"] for e in entries]
    assert kinds == ["task.start", "tool.call", "tool.result"]


async def test_bad_messages_are_reported_not_fatal(h):
    await h.core.handle('{"type":"nope"}')
    assert h.last(A2S.LOG)["level"] == "warning"
    await h.core.handle(msg(S2A.TOOL_CALL, id="x", task_id="ghost", name="python", args={}))
    assert "unknown_task" in h.last(A2S.TOOL_RESULT, id="x")["error"]


async def test_step_budget_is_enforced(h):
    await h.start_task(steps=2)
    await h.call("t1", "python", call_id="a", code="1")
    await h.call("t1", "python", call_id="b", code="2")
    r = await h.call("t1", "python", call_id="c", code="3")
    assert not r["ok"] and "budget_exceeded" in r["error"]


async def test_computer_tool_returns_image_and_desktop_lock_is_exclusive(h):
    await h.start_task("t1")
    await h.start_task("t2")
    r = await h.call("t1", "computer", call_id="s", action="click", x=10, y=20)
    assert r["ok"]
    png = base64.b64decode(r["image_b64"])
    assert png.startswith(b"\x89PNG")
    assert ("click", (10, 20, 1, 1)) in h.backend.calls
    busy = await h.call("t2", "computer", call_id="b", action="screenshot")
    assert not busy["ok"] and "desktop_busy" in busy["error"]
    # Code-only tasks keep running while t1 holds the desktop.
    ok = await h.call("t2", "python", call_id="p", code="print('parallel')")
    assert ok["ok"]
    # Stopping t1 frees the desktop for t2.
    await h.core.handle(msg(S2A.TASK_STOP, task_id="t1", reason="done"))
    r2 = await h.call("t2", "computer", call_id="b2", action="screenshot")
    assert r2["ok"]


async def test_computer_rejects_unknown_action(h):
    await h.start_task()
    r = await h.call("t1", "computer", action="launch_missiles")
    assert not r["ok"] and "computer.action" in r["error"]


async def test_pause_blocks_tools_and_screenshots_until_resume(h):
    await h.start_task("t1")
    await h.start_task("t2")
    await h.core.handle(msg(S2A.TASK_PAUSE, task_id="t1", handoff_id="h1", reason="login"))
    r = await h.call("t1", "python", call_id="a", code="1")
    assert "task_paused" in r["error"]
    # Another task may run code, but no one captures the screen during a handoff.
    r2 = await h.call("t2", "computer", call_id="b", action="screenshot")
    assert "handoff_active" in r2["error"]
    assert h.core.vm_state()["handoff_active"] is True
    await h.core.handle(msg(S2A.HANDOFF_RESUME, task_id="t1", handoff_id="h1", outcome="done"))
    r3 = await h.call("t1", "python", call_id="c", code="print('back')")
    assert r3["ok"]
    assert h.core.vm_state()["handoff_active"] is False


async def test_agentlib_say_and_approval_round_trip_through_the_kernel(h):
    await h.start_task()
    code = (
        "import agentlib\n"
        "agentlib.say('working')\n"
        "ok = agentlib.request_approval('send', {'to': 'a@b.c'})\n"
        "print('approved' if ok else 'denied')\n"
    )
    call = asyncio.ensure_future(h.call("t1", "python", call_id="p", code=code))
    say = await h.wait_for(A2S.EVENT, kind=EventKind.SAY)
    assert say["payload"]["text"] == "working"
    req = await h.wait_for(A2S.EVENT, kind=EventKind.APPROVAL_REQUEST)
    assert req["payload"]["action"] == "send"
    assert h.core.tasks["t1"].kernel.blocked is True
    await h.core.handle(
        msg(S2A.APPROVAL_ANSWER, task_id="t1", approval_id=req["request_id"], approved=True)
    )
    r = await call
    assert r["ok"] and "approved" in r["output"]
    assert h.core.tasks["t1"].kernel.blocked is False


async def test_agentlib_handoff_pauses_until_resume(h):
    await h.start_task()
    code = "import agentlib\nprint(agentlib.handoff('captcha', url='https://x'))\n"
    call = asyncio.ensure_future(h.call("t1", "python", call_id="p", code=code))
    req = await h.wait_for(A2S.EVENT, kind=EventKind.HANDOFF_REQUEST)
    assert h.core.handoff_active is True
    await h.core.handle(
        msg(S2A.HANDOFF_RESUME, task_id="t1", handoff_id=req["request_id"], outcome="done")
    )
    r = await call
    assert r["ok"] and r["output"].strip() == "done"
    assert h.core.handoff_active is False


async def test_agentlib_api_result(h):
    await h.start_task()
    code = "import agentlib\nprint(agentlib.api('github', 'GET', '/user'))\n"
    call = asyncio.ensure_future(h.call("t1", "python", call_id="p", code=code))
    req = await h.wait_for(A2S.EVENT, kind=EventKind.API_REQUEST)
    await h.core.handle(
        msg(
            S2A.API_RESULT,
            task_id="t1",
            request_id=req["request_id"],
            ok=True,
            result={"login": "octocat"},
        )
    )
    r = await call
    assert "octocat" in r["output"]


async def test_stop_writes_result_and_restart_restores_step_count(h, cfg):
    await h.start_task()
    await h.call("t1", "python", call_id="a", code="1")
    await h.core.handle(
        msg(S2A.TASK_STOP, task_id="t1", reason="done", result={"status": "done", "say": "ok"})
    )
    assert h.last(A2S.TASK_STOPPED)["task_id"] == "t1"
    assert json.loads((disk.task_dir(cfg.home, "t1") / "result.json").read_text())["say"] == "ok"
    started = await h.start_task()
    assert started["restored"] is True
    assert h.core.tasks["t1"].steps == 1


async def test_vm_state(h):
    await h.start_task()
    await h.core.handle(msg(S2A.VM_STATUS))
    st = h.last(A2S.VM_STATE)
    assert st["tasks"][0]["task_id"] == "t1"
    assert st["desktop_owner"] is None


async def test_computer_refused_while_the_user_holds_control(h):
    await h.start_task()
    await h.core.handle(msg(S2A.CONTROL, active=True))
    state = h.last(A2S.VM_STATE)
    assert state["user_control"] is True and state["streams"] == []
    r = await h.call("t1", "computer", action="screenshot")
    assert r["ok"] is False and r["error"] == "user_control: the user controls the desktop"
    assert h.backend.calls == []
    # Code-only work keeps running.
    r = await h.call("t1", "python", call_id="c2", code="print(1)")
    assert r["ok"] is True
    await h.core.handle(msg(S2A.CONTROL, active=False))
    r = await h.call("t1", "computer", call_id="c3", action="screenshot")
    assert r["ok"] is True and h.core.vm_state()["user_control"] is False


async def test_stream_start_offers_and_vm_state_lists_it(h):
    assert h.core.input_allowed("s1") is False
    await h.core.handle(msg(S2A.STREAM_START, stream_id="s1", ice_servers=[]))
    offer = h.last(A2S.SIGNAL, stream_id="s1")
    assert offer["payload"]["description"]["type"] == "offer"
    assert h.last(A2S.VM_STATE)["streams"] == ["s1"]
    # Control without a stream id lets no stream drive the desktop.
    await h.core.handle(msg(S2A.CONTROL, active=True))
    assert h.core.input_allowed("s1") is False
    # Control names the controlling device's stream: that one only.
    await h.core.handle(msg(S2A.CONTROL, active=True, stream_id="s1"))
    assert h.core.input_allowed("s1") is True
    assert h.core.input_allowed("s2") is False
    assert h.last(A2S.VM_STATE)["control_stream_id"] == "s1"
    await h.core.handle(msg(S2A.CONTROL, active=False))
    assert h.core.input_allowed("s1") is False
    await h.core.handle(msg(S2A.STREAM_STOP, stream_id="s1"))
    assert h.last(A2S.VM_STATE)["streams"] == []
    # A signal for a stream that is gone is dropped, not an error.
    await h.core.handle(msg(S2A.SIGNAL, stream_id="s1", payload={"candidate": {}}))


async def test_handoff_alone_allows_stream_input(h):
    await h.start_task()
    await h.core.handle(msg(S2A.TASK_PAUSE, task_id="t1", handoff_id="h1", reason="login"))
    assert h.core.input_allowed("any") is True
    await h.core.handle(msg(S2A.HANDOFF_RESUME, task_id="t1", handoff_id="h1", outcome="done"))
    assert h.core.input_allowed("any") is False


async def test_control_taken_while_waiting_for_the_lock_is_refused(h):
    """The wait for the desktop lock is a window; the gates are checked again after it."""
    await h.start_task("t1")
    await h.start_task("t2")
    await h.call("t1", "computer", call_id="a", action="screenshot")  # t1 holds the lock
    await h.core.handle(
        msg(
            S2A.TOOL_CALL,
            id="b",
            task_id="t2",
            name="computer",
            args={"action": "click", "x": 1, "y": 2},
        )
    )
    await asyncio.sleep(0.05)  # t2 is now waiting for the lock
    await h.core.handle(msg(S2A.CONTROL, active=True))
    await h.core.handle(msg(S2A.TASK_STOP, task_id="t1", reason="done"))  # frees the lock
    r = await h.wait_for(A2S.TOOL_RESULT, id="b")
    assert r["ok"] is False and r["error"].startswith("user_control")
    assert ("click", (1, 2, 1, 1)) not in h.backend.calls


async def test_handoff_during_settle_drops_the_capture(h):
    """A handoff that starts while an action settles stops the screenshot."""
    await h.start_task("t1")
    await h.start_task("t2")
    await h.core.handle(
        msg(
            S2A.TOOL_CALL,
            id="a",
            task_id="t1",
            name="computer",
            args={"action": "click", "x": 1, "y": 1, "settle_seconds": 0.4},
        )
    )
    await asyncio.sleep(0.1)
    await h.core.handle(msg(S2A.TASK_PAUSE, task_id="t2", handoff_id="h1", reason="login"))
    r = await h.wait_for(A2S.TOOL_RESULT, id="a")
    assert r["ok"] is False and "capture_refused" in r["error"]
    assert ("screenshot", ()) not in h.backend.calls


async def test_pump_is_not_blocked_by_a_step_waiting_on_agentlib(h):
    """handle() returns while a python step blocks in agentlib, so the answer can arrive."""
    await h.start_task()
    code = "import agentlib\nprint(agentlib.request_approval('send', {}))"
    await h.core.handle(
        msg(S2A.TOOL_CALL, id="p", task_id="t1", name="python", args={"code": code})
    )
    req = await h.wait_for(A2S.EVENT, kind=EventKind.APPROVAL_REQUEST)
    await h.core.handle(
        msg(S2A.APPROVAL_ANSWER, task_id="t1", approval_id=req["request_id"], approved=False)
    )
    r = await h.wait_for(A2S.TOOL_RESULT, id="p")
    assert r["ok"] and r["output"].strip() == "False"


async def test_restart_restores_a_paused_task(h, cfg):
    await h.start_task()
    await h.core.handle(msg(S2A.TASK_PAUSE, task_id="t1", handoff_id="h1", reason="login"))
    # agentd restarts: a fresh core over the same disk.
    await h.core.shutdown()
    fresh = AgentdCore(cfg, FakeBackend(), h._send)
    await fresh.handle(
        msg(S2A.TASK_START, task_id="t1", job_id="j1", request="do a thing", budget={})
    )
    try:
        assert fresh.tasks["t1"].paused is True and fresh.tasks["t1"].handoff_id == "h1"
        assert fresh.handoff_active is True
    finally:
        await fresh.shutdown()


async def test_kernel_has_no_display(h, monkeypatch):
    monkeypatch.setenv("DISPLAY", ":0")
    await h.start_task()
    code = "import os; print(sorted(k for k in os.environ if k in ('DISPLAY', 'XAUTHORITY')))"
    r = await h.call("t1", "python", code=code)
    assert r["ok"] and r["output"].strip() == "[]"
