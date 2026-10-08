"""Screen streams and desktop control through the session server."""

import base64
import hashlib
import hmac
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from apparatus_protocol import A2S, S2A, S2C, msg
from apparatus_server.main import build_deps, create_app
from apparatus_server.model import FakeSmartModel
from apparatus_server.streams import StreamRegistry, ice_servers, turn_credentials
from apparatus_server.tokens import FakeTokenMinter


def test_turn_credentials_follow_coturn_use_auth_secret():
    username, credential, expiry = turn_credentials("s3cret", 3600, now=1_000_000)
    assert expiry == 1_003_600
    assert username == "1003600:apparatus"
    expected = base64.b64encode(
        hmac.new(b"s3cret", username.encode(), hashlib.sha1).digest()
    ).decode()
    assert credential == expected
    # A different secret or a different expiry changes the credential.
    assert turn_credentials("other", 3600, now=1_000_000)[1] != credential
    assert turn_credentials("s3cret", 60, now=1_000_000)[0] == "1000060:apparatus"


def test_ice_servers_without_turn_is_stun_only(settings):
    assert ice_servers(settings) == [{"urls": ["stun:stun.l.google.com:19302"]}]


def test_ice_servers_with_turn_adds_minted_credential(settings):
    s = replace(settings, turn_url="turn:1.2.3.4:3478?transport=udp", turn_secret="s3cret")
    servers = ice_servers(s, now=1_000_000)
    assert servers[0] == {"urls": ["stun:stun.l.google.com:19302"]}
    turn = servers[1]
    assert turn["urls"] == ["turn:1.2.3.4:3478?transport=udp"]
    assert turn["username"] == f"{1_000_000 + s.stream.turn_ttl_seconds}:apparatus"
    assert turn["credential"] == turn_credentials("s3cret", s.stream.turn_ttl_seconds, 1_000_000)[1]
    # A URL without a secret mints nothing.
    assert len(ice_servers(replace(s, turn_secret=""))) == 1


def test_registry_ownership_and_control():
    reg = StreamRegistry()
    st = reg.open("u", "d1")
    assert reg.owned(st.stream_id, "u") is st
    assert reg.owned(st.stream_id, "other") is None
    assert reg.for_device("u", "d1") == [st] and reg.for_device("u", "d2") == []
    assert reg.control("u").to_dict() == {"active": False, "by": None}
    assert reg.take("u", "d1").to_dict() == {"active": True, "by": "d1"}
    assert reg.release("u", "d2") is None  # d2 does not hold it
    assert reg.release("u", "d1").to_dict() == {"active": False, "by": None}
    assert reg.release("u") is None  # nothing to release
    assert reg.close(st.stream_id) is st and reg.close(st.stream_id) is None


@pytest.fixture
def world(settings):
    deps = build_deps(settings, model=FakeSmartModel([]), tokens=FakeTokenMinter())
    app = create_app(deps)
    with TestClient(app) as client:
        yield client, deps


def connect_vm(client, user):
    vm = client.websocket_connect("/ws/agentd")
    vm.__enter__()
    vm.send_json(msg(A2S.HELLO, vm_id="vm-1", user_id=user, auth="", version=1, capabilities={}))
    assert vm.receive_json()["type"] == "control"  # the server syncs control on every connect
    return vm


def hello(vm, user):
    vm.send_json(msg(A2S.HELLO, vm_id="vm-1", user_id=user, auth="", version=1))
    sync = vm.receive_json()
    assert sync["type"] == "control"
    return sync


def test_screen_open_reaches_vm_and_only_the_opening_device(world):
    client, deps = world
    with client.websocket_connect("/ws/agentd") as vm:
        hello(vm, "erin")
        with (
            client.websocket_connect("/ws/client?auth=erin&device=web") as a,
            client.websocket_connect("/ws/client?auth=erin&device=ios") as b,
        ):
            ready = a.receive_json()
            assert ready["control"] == {"active": False, "by": None} and ready["streams"] == []
            b.receive_json()
            a.send_json({"type": "screen.open"})
            start = vm.receive_json()
            assert start["type"] == S2A.STREAM_START
            assert start["ice_servers"] == [{"urls": ["stun:stun.l.google.com:19302"]}]
            opened = a.receive_json()
            assert opened["type"] == S2C.SCREEN_OPENED
            assert opened["stream_id"] == start["stream_id"]
            assert opened["ice_servers"] == start["ice_servers"]
            stream_id = opened["stream_id"]

            # The VM's offer goes to the owning device only.
            vm.send_json(
                msg(A2S.SIGNAL, stream_id=stream_id, payload={"description": {"type": "offer"}})
            )
            sig = a.receive_json()
            assert sig == {
                "type": "signal",
                "stream_id": stream_id,
                "payload": {"description": {"type": "offer"}},
            }
            # The client's answer goes to the VM with the same stream id.
            a.send_json(
                {
                    "type": "signal",
                    "stream_id": stream_id,
                    "payload": {"description": {"type": "answer", "sdp": "v=0"}},
                }
            )
            relayed = vm.receive_json()
            assert relayed["type"] == S2A.SIGNAL and relayed["stream_id"] == stream_id
            assert relayed["payload"]["description"]["sdp"] == "v=0"
            # A second device cannot signal on a stream it does not own.
            b.send_json({"type": "signal", "stream_id": stream_id, "payload": {"candidate": {}}})
            b.send_json({"type": "ping"})
            assert b.receive_json()["type"] == "pong"

            a.send_json({"type": "screen.close", "stream_id": stream_id})
            stop = vm.receive_json()
            assert stop == {"type": "stream.stop", "stream_id": stream_id}
            closed = a.receive_json()
            assert closed == {"type": "screen.closed", "stream_id": stream_id, "reason": "closed"}
            # b saw nothing of the stream.
            b.send_json({"type": "ping"})
            assert b.receive_json()["type"] == "pong"
    audit = client.get("/audit", headers={"Authorization": "Bearer erin"}).json()["entries"]
    kinds = [e["kind"] for e in audit]
    assert "screen.open" in kinds and "screen.close" in kinds
    entry = next(e for e in audit if e["kind"] == "screen.open")
    assert entry["device_id"] == ready["device_id"] and entry["stream_id"] == stream_id


def test_control_take_reaches_vm_and_every_device(world):
    client, deps = world
    with client.websocket_connect("/ws/agentd") as vm:
        hello(vm, "finn")
        with (
            client.websocket_connect("/ws/client?auth=finn&device=web") as a,
            client.websocket_connect("/ws/client?auth=finn&device=ios") as b,
        ):
            device_a = a.receive_json()["device_id"]
            b.receive_json()
            a.send_json({"type": "control.take"})
            assert vm.receive_json() == {"type": "control", "active": True}
            assert a.receive_json() == {"type": "control", "active": True, "by": device_a}
            assert b.receive_json() == {"type": "control", "active": True, "by": device_a}
            # A late device learns the state from ready.
            with client.websocket_connect("/ws/client?auth=finn&device=desktop") as c:
                assert c.receive_json()["control"] == {"active": True, "by": device_a}
            # Another device cannot release what it does not hold.
            b.send_json({"type": "control.release"})
            b.send_json({"type": "ping"})
            assert b.receive_json()["type"] == "pong"
            a.send_json({"type": "control.release"})
            assert vm.receive_json() == {"type": "control", "active": False}
            assert a.receive_json() == {"type": "control", "active": False, "by": None}
            assert b.receive_json() == {"type": "control", "active": False, "by": None}
    audit = client.get("/audit", headers={"Authorization": "Bearer finn"}).json()["entries"]
    take = next(e for e in audit if e["kind"] == "control.take")
    release = next(e for e in audit if e["kind"] == "control.release")
    assert take["device_id"] == device_a and release["device_id"] == device_a


def test_device_disconnect_stops_its_stream_and_releases_control(world):
    client, deps = world
    with client.websocket_connect("/ws/agentd") as vm:
        hello(vm, "gus")
        with client.websocket_connect("/ws/client?auth=gus&device=ios") as b:
            b.receive_json()
            with client.websocket_connect("/ws/client?auth=gus&device=web") as a:
                a.receive_json()
                a.send_json({"type": "screen.open"})
                stream_id = vm.receive_json()["stream_id"]
                a.receive_json()
                a.send_json({"type": "control.take"})
                vm.receive_json()
                a.receive_json()
                b.receive_json()
            stop = vm.receive_json()
            assert stop == {"type": "stream.stop", "stream_id": stream_id}
            assert vm.receive_json() == {"type": "control", "active": False}
            assert b.receive_json() == {"type": "control", "active": False, "by": None}
            assert deps.streams.for_user("gus") == []


def test_vm_disconnect_closes_streams_and_reconnect_restores_control(world):
    client, deps = world
    with client.websocket_connect("/ws/client?auth=hana&device=web") as a:
        a.receive_json()
        # No VM: screen.open answers error.
        a.send_json({"type": "screen.open"})
        err = a.receive_json()
        assert err["type"] == "error" and err["code"] == "stream"
        with client.websocket_connect("/ws/agentd") as vm:
            hello(vm, "hana")
            a.send_json({"type": "screen.open"})
            stream_id = vm.receive_json()["stream_id"]
            a.receive_json()
            a.send_json({"type": "control.take"})
            assert vm.receive_json()["type"] == "control"
            a.receive_json()
        closed = a.receive_json()
        assert closed == {
            "type": "screen.closed",
            "stream_id": stream_id,
            "reason": "vm.disconnect",
        }
        assert deps.streams.for_user("hana") == []
        assert deps.streams.control("hana").active is True
        with client.websocket_connect("/ws/agentd") as vm2:
            vm2.send_json(msg(A2S.HELLO, vm_id="vm-1", user_id="hana", auth="", version=1))
            assert vm2.receive_json() == {"type": "control", "active": True}


def test_control_names_the_controlling_stream_and_reconnect_syncs_release(world):
    client, deps = world
    with client.websocket_connect("/ws/client?auth=ivy&device=web") as a:
        a.receive_json()
        with client.websocket_connect("/ws/agentd") as vm:
            hello(vm, "ivy")
            a.send_json({"type": "control.take"})
            # No stream yet: control without a stream id.
            assert vm.receive_json() == {"type": "control", "active": True}
            a.receive_json()
            a.send_json({"type": "screen.open"})
            opened = a.receive_json()
            assert opened["type"] == "screen.opened"  # the client learns the id first
            start = vm.receive_json()
            assert start["type"] == "stream.start" and start["stream_id"] == opened["stream_id"]
            # The controlling device now has a stream: agentd is told which one.
            assert vm.receive_json() == {
                "type": "control",
                "active": True,
                "stream_id": opened["stream_id"],
            }
            # Closing it keeps control but names no stream.
            a.send_json({"type": "screen.close", "stream_id": opened["stream_id"]})
            assert vm.receive_json()["type"] == "stream.stop"
            assert vm.receive_json() == {"type": "control", "active": True}
            assert a.receive_json()["type"] == "screen.closed"
        # The VM link is down while the user releases control.
        a.send_json({"type": "control.release"})
        assert a.receive_json() == {"type": "control", "active": False, "by": None}
        with client.websocket_connect("/ws/agentd") as vm2:
            # A reconnect always carries the current state, released included.
            assert hello(vm2, "ivy") == {"type": "control", "active": False}


def test_vm_state_reconciles_streams_agentd_dropped(world):
    client, deps = world
    with client.websocket_connect("/ws/agentd") as vm:
        hello(vm, "jon")
        with client.websocket_connect("/ws/client?auth=jon&device=web") as a:
            a.receive_json()
            a.send_json({"type": "screen.open"})
            stream_id = a.receive_json()["stream_id"]
            vm.receive_json()  # stream.start
            # agentd ended the stream on its own (peer failed) and reports no streams.
            vm.send_json(
                msg(A2S.VM_STATE, tasks=[], handoff_active=False, streams=[], user_control=False)
            )
            closed = a.receive_json()
            assert closed == {
                "type": "screen.closed",
                "stream_id": stream_id,
                "reason": "vm.closed",
            }
            assert deps.streams.for_user("jon") == []
