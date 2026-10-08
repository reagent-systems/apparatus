"""agentlib: thin calls from task code to the session server, through agentd.

Each function only sends a request over the agentd Unix socket and returns
the reply. No logic lives here. The server decides what happens.

    import agentlib
    agentlib.say("Found 12 rows.")
    agentlib.progress("Reading page 3 of 7", percent=40)
    if agentlib.request_approval("send", {"to": "x@example.com", "subject": "Hi"}):
        ...
    data = agentlib.api("github", "GET", "/user/repos")
    agentlib.handoff("Login page", url="https://example.com/login")
"""

from __future__ import annotations

import json
import os
import socket
from typing import Any

__all__ = ["say", "progress", "show", "request_approval", "api", "handoff", "AgentlibError"]


class AgentlibError(RuntimeError):
    pass


def _call(op: str, timeout: float | None = None, **fields: Any) -> dict[str, Any]:
    path = os.environ.get("AGENTD_SOCKET")
    task_id = os.environ.get("AGENT_TASK_ID")
    if not path or not task_id:
        raise AgentlibError("agentlib only works inside a task kernel started by agentd")
    req = {"op": op, "task_id": task_id, **fields}
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        s.connect(path)
        s.sendall((json.dumps(req) + "\n").encode())
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
    if not buf:
        raise AgentlibError("agentd closed the socket without a reply")
    reply = json.loads(buf.decode())
    if not isinstance(reply, dict):
        raise AgentlibError("bad reply from agentd")
    return reply


def say(text: str) -> None:
    """Ask the voice model to speak one short line now."""
    _call("say", timeout=10, text=str(text))


def progress(text: str, percent: float | None = None) -> None:
    """Report progress. Shows in the feed; the voice may mention it."""
    _call("progress", timeout=10, text=str(text), percent=percent)


def show(content: str, target: str | None = None) -> None:
    """Send markdown to the screen of the client."""
    _call("show", timeout=10, content=str(content), target=target)


def request_approval(action: str, details: Any) -> bool:
    """Block until the user approves or denies ``action``.

    ``action`` is one of: send, buy, delete, post, share, account_change.
    Returns True only on an explicit approval.
    """
    reply = _call("request_approval", timeout=None, action=str(action), details=details)
    if not reply.get("ok"):
        raise AgentlibError(reply.get("error", "approval failed"))
    return bool(reply.get("approved"))


def api(service: str, method: str, path: str, body: Any = None) -> Any:
    """Call a connected service through the server, which adds the token."""
    reply = _call(
        "api", timeout=None, service=str(service), method=str(method), path=str(path), body=body
    )
    if not reply.get("ok"):
        raise AgentlibError(reply.get("error", "api call failed"))
    return reply.get("result")


def handoff(reason: str, url: str | None = None) -> str:
    """Pause and ask the user to take over the screen. Returns the outcome.

    Outcome is ``done``, ``cancel`` or ``timeout``. Code that needs the
    user's login calls this and then re-reads the page.
    """
    reply = _call("handoff", timeout=None, reason=str(reason), url=url)
    if not reply.get("ok"):
        raise AgentlibError(reply.get("error", "handoff failed"))
    return str(reply.get("outcome"))
