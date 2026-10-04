"""HTTP and WebSocket surface of the session server."""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from apparatus_protocol import A2S, S2A, msg
from apparatus_server.main import build_deps, create_app
from apparatus_server.model import FakeSmartModel, FunctionCall, ModelReply, Usage
from apparatus_server.tokens import FakeTokenMinter


@pytest.fixture
def world(settings):
    model = FakeSmartModel(
        [
            ModelReply(
                calls=[FunctionCall("c1", "python", {"code": "print('hi')"})], usage=Usage(100, 10)
            ),
            ModelReply(text='{"status":"done","say":"Said hi."}', usage=Usage(100, 10)),
        ]
    )
    deps = build_deps(settings, model=model, tokens=FakeTokenMinter())
    deps.jobs.vm_connect_timeout = 5
    app = create_app(deps)
    with TestClient(app) as client:
        yield client, deps


def test_health_and_gate_config(world):
    client, deps = world
    assert client.get("/health").json()["ok"] is True
    gate = client.get("/config/gate").json()
    assert gate["silence_incomplete_ms"] == 2500


def test_token_needs_auth_and_returns_setup(world):
    client, deps = world
    assert client.post("/token").status_code == 401
    r = client.post("/token", headers={"Authorization": "Bearer alice"})
    assert r.status_code == 200
    body = r.json()
    assert body["token"].startswith("auth_tokens/")
    assert body["model"] == "gemini-3.8-live"
    assert (
        body["setup"]["setup"]["realtimeInputConfig"]["automaticActivityDetection"]["disabled"]
        is True
    )
    assert body["live"]["idle_close_seconds"] == 120
    assert deps.vm_controller.started == ["alice"]
    minted = deps.tokens.minted[0]
    assert minted["model"] == "gemini-3.8-live"
    assert minted["live_config"]["tools"][0]["function_declarations"][0]["name"] == "start_job"


def test_token_refused_without_credits(world):
    client, deps = world
    acct = asyncio.run(deps.ledger.account("broke"))
    acct["balance"] = 0
    asyncio.run(deps.store.put("ledger", "broke", acct))
    assert client.post("/token", headers={"Authorization": "Bearer broke"}).status_code == 402


def test_client_socket_rejects_bad_auth(world):
    client, deps = world
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/client?auth=bad%20token&device=web"):
            pass


def test_client_hello_ready_voice_and_show(world):
    client, deps = world
    with client.websocket_connect("/ws/client?auth=bob&device=web") as ws:
        ready = ws.receive_json()
        assert ready["type"] == "ready" and ready["user_id"] == "bob"
        assert ready["gate"]["bargein_min_words"] == 2
        assert ready["balance"] == 500
        ws.send_json({"type": "hello", "device": "web", "wants_voice": True})
        assert ws.receive_json()["type"] == "voice.granted"
        ws.send_json(
            {"type": "tool.call", "call_id": "k1", "name": "show", "args": {"content": "# hi"}}
        )
        shown = ws.receive_json()
        assert shown["type"] == "show" and shown["content"] == "# hi"
        result = ws.receive_json()
        assert result == {
            "type": "tool.result",
            "call_id": "k1",
            "name": "show",
            "response": {"ok": True},
            "scheduling": "SILENT",
        }
        ws.send_json({"type": "nonsense"})
        assert ws.receive_json()["type"] == "error"
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
        with client.websocket_connect("/ws/client?auth=bob&device=ios") as ws2:
            ws2.receive_json()
            ws2.send_json({"type": "voice.claim"})
            assert ws2.receive_json()["type"] == "voice.granted"
            assert ws.receive_json()["type"] == "voice.revoked"


def test_agentd_socket_requires_hello(world):
    client, deps = world
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/agentd") as ws:
            ws.send_json({"type": "log", "level": "info", "message": "x"})
            ws.receive_json()


def test_full_job_through_both_sockets(world):
    """Client relays start_job; a scripted agentd answers; the client gets job.done with voice."""
    client, deps = world
    with client.websocket_connect("/ws/agentd") as vm:
        vm.send_json(
            msg(A2S.HELLO, vm_id="vm-1", user_id="carol", auth="", version=1, capabilities={})
        )
        assert vm.receive_json()["type"] == "control"  # state sync on connect
        with client.websocket_connect("/ws/client?auth=carol&device=web") as ws:
            ws.receive_json()  # ready
            ws.send_json({"type": "hello", "device": "web", "wants_voice": True})
            assert ws.receive_json()["type"] == "voice.granted"
            ws.send_json(
                {
                    "type": "tool.call",
                    "call_id": "k",
                    "name": "start_job",
                    "args": {"request": "say hi"},
                }
            )
            seen = {}
            for _ in range(2):
                m = ws.receive_json()
                seen[m["type"]] = m
            assert seen["tool.result"]["scheduling"] == "SILENT"
            job_id = seen["tool.result"]["response"]["job_id"]
            assert seen["job.started"]["job_id"] == job_id
            start = vm.receive_json()
            assert start["type"] == S2A.TASK_START and start["job_id"] == job_id
            vm.send_json(
                msg(
                    A2S.TASK_STARTED,
                    task_id=start["task_id"],
                    memory_index="",
                    tools_index="",
                    restored=False,
                )
            )
            call = vm.receive_json()
            assert call["type"] == S2A.TOOL_CALL and call["args"]["code"] == "print('hi')"
            vm.send_json(
                msg(
                    A2S.TOOL_RESULT,
                    id=call["id"],
                    task_id=call["task_id"],
                    ok=True,
                    output="hi\n",
                    files=[],
                )
            )
            stop = vm.receive_json()
            assert stop["type"] == S2A.TASK_STOP and stop["result"]["say"] == "Said hi."
            vm.send_json(msg(A2S.TASK_STOPPED, task_id=stop["task_id"]))
            done = ws.receive_json()
            assert done["type"] == "job.done" and done["say"] == "Said hi."
            assert done["voice"] == f"job.done {job_id}: Said hi."
            credits = ws.receive_json()
            assert credits["type"] == "credits" and credits["state"] == "ok"
            ws.send_json(
                {
                    "type": "tool.call",
                    "call_id": "k2",
                    "name": "check_job",
                    "args": {"job_id": job_id},
                }
            )
            r = ws.receive_json()
            assert r["response"]["status"] == "done" and r["response"]["say"] == "Said hi."
    audit = client.get("/audit", headers={"Authorization": "Bearer carol"}).json()["entries"]
    assert {"vm.connect", "voice.tool", "job.start", "tool.call", "job.end"} <= {
        e["kind"] for e in audit
    }
    jobs = client.get("/jobs", headers={"Authorization": "Bearer carol"}).json()["jobs"]
    assert jobs[0]["status"] == "done"


def test_live_usage_is_metered_and_session_state_is_kept(world):
    client, deps = world
    with client.websocket_connect("/ws/client?auth=dave&device=web") as ws:
        ws.receive_json()
        ws.send_json({"type": "live.usage", "audio_in_ms": 60000, "audio_out_ms": 60000})
        credits = ws.receive_json()
        assert credits["type"] == "credits" and credits["balance"] == 496
        ws.send_json({"type": "live.resumption", "handle": "h-9"})
        ws.send_json({"type": "transcript", "role": "user", "text": "book a flight", "final": True})
        echoed = ws.receive_json()
        assert echoed["type"] == "transcript" and echoed["text"] == "book a flight"
    r = client.post("/token", headers={"Authorization": "Bearer dave"}).json()
    assert r["resumption_handle"] == "h-9"
    assert "book a flight" in json.dumps(r["setup"])


def test_static_routes_serve_the_vite_layout_and_nothing_outside_dist(settings, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>apparatus</title>")
    (dist / "assets" / "app-abc123.js").write_text("console.log(1)")
    (dist / "bridge.js").write_text("window.bridge = {}")
    (dist / "worklet.js").write_text("registerProcessor('x', class {})")
    (dist / "favicon.svg").write_text("<svg/>")
    (tmp_path / "secret.txt").write_text("no")
    from dataclasses import replace

    deps = build_deps(
        replace(settings, web_dist=str(dist)), model=FakeSmartModel([]), tokens=FakeTokenMinter()
    )
    with TestClient(create_app(deps)) as client:
        r = client.get("/")
        assert r.status_code == 200 and "apparatus" in r.text
        assert r.headers["content-type"].startswith("text/html")
        r = client.get("/assets/app-abc123.js")
        assert r.status_code == 200 and r.text == "console.log(1)"
        for name in ("bridge.js", "worklet.js"):
            r = client.get(f"/{name}")
            assert r.status_code == 200 and r.headers["content-type"].startswith("text/javascript")
        r = client.get("/favicon.svg")
        assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg+xml")
        assert client.get("/nope.js").status_code == 404
        assert client.get("/..%2Fsecret.txt").status_code == 404
        assert client.get("/health").status_code == 200  # API routes win over the catch-all


def test_static_routes_work_without_an_assets_folder(settings, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html>")
    from dataclasses import replace

    deps = build_deps(
        replace(settings, web_dist=str(dist)), model=FakeSmartModel([]), tokens=FakeTokenMinter()
    )
    with TestClient(create_app(deps)) as client:
        assert client.get("/").status_code == 200
        assert client.get("/assets/x.js").status_code == 404
