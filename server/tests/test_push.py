import httpx

from apparatus_server.push import FcmPush, LogPush, fcm_message


def test_fcm_message_sets_category_for_actionable_kinds():
    m = fcm_message("tok", "Approve: send?", "to a@b", {"kind": "approval", "approval_id": "a1"})
    assert m["apns"]["payload"]["aps"]["category"] == "apparatus.approval"
    assert m["android"]["notification"]["click_action"] == "apparatus.approval"
    assert m["data"] == {"kind": "approval", "approval_id": "a1"}
    plain = fcm_message("tok", "Done", "x", {"kind": "job.done", "job_id": "j"})
    assert "category" not in plain["apns"]["payload"]["aps"]


async def test_fcm_push_posts_one_message_per_token():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.headers["Authorization"], request.read()))
        return httpx.Response(200, json={"name": "projects/p/messages/1"})

    async def token_provider() -> str:
        return "bearer-1"

    push = FcmPush(
        "p", token_provider, client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    n = await push.send(["t1", "t2"], "Your turn", "login", {"kind": "handoff", "handoff_id": "h"})
    assert n == 2
    assert all(auth == "Bearer bearer-1" for auth, _ in seen)
    assert b"apparatus.handoff" in seen[0][1]


async def test_log_push_records():
    p = LogPush()
    assert await p.send(["t"], "a", "b", {"kind": "credits"}) == 1
    assert p.sent[0]["title"] == "a"
