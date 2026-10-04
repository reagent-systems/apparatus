"""Wire protocol for apparatus.

Three links share this module:

* client <-> session server  (``C2S``, ``S2C``)
* session server <-> agentd  (``S2A``, ``A2S``)
* agentlib <-> agentd        (``LIB``), JSON lines over a Unix socket

Every message is one JSON object with a ``type`` field. The constants
below are the only legal values. ``parse`` checks the shape of an inbound
message and raises ``ProtocolError`` on anything else, so a bad peer
fails at the edge and not deep in a handler.

agent-kit/docs/PROTOCOL.md is the human copy of this file. Change both.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Any

PROTOCOL_VERSION = 1


class ProtocolError(ValueError):
    """An inbound message does not match the protocol."""


# --------------------------------------------------------------------------- #
# Message type names
# --------------------------------------------------------------------------- #


class C2S:
    """Client to session server."""

    HELLO = "hello"
    VOICE_CLAIM = "voice.claim"
    VOICE_RELEASE = "voice.release"
    TRANSCRIPT = "transcript"
    TOOL_CALL = "tool.call"
    HANDOFF_DONE = "handoff.done"
    HANDOFF_CANCEL = "handoff.cancel"
    APPROVAL_ANSWER = "approval.answer"
    LIVE_USAGE = "live.usage"
    LIVE_RESUMPTION = "live.resumption"
    LIVE_CLOSED = "live.closed"
    SIGNAL = "signal"
    PUSH_REGISTER = "push.register"
    PING = "ping"

    ALL = frozenset(
        {
            HELLO,
            PUSH_REGISTER,
            VOICE_CLAIM,
            VOICE_RELEASE,
            TRANSCRIPT,
            TOOL_CALL,
            HANDOFF_DONE,
            HANDOFF_CANCEL,
            APPROVAL_ANSWER,
            LIVE_USAGE,
            LIVE_RESUMPTION,
            LIVE_CLOSED,
            SIGNAL,
            PING,
        }
    )


class S2C:
    """Session server to client.

    Any message may carry a ``voice`` string. A client that holds the live
    voice session sends that string into the session as an event turn, so
    the voice model speaks about it. Clients without the voice session
    ignore it.
    """

    READY = "ready"
    VOICE_GRANTED = "voice.granted"
    VOICE_REVOKED = "voice.revoked"
    TRANSCRIPT = "transcript"
    JOB_STARTED = "job.started"
    JOB_PROGRESS = "job.progress"
    JOB_DONE = "job.done"
    SHOW = "show"
    HANDOFF_REQUESTED = "handoff.requested"
    HANDOFF_ENDED = "handoff.ended"
    APPROVAL_REQUESTED = "approval.requested"
    APPROVAL_ENDED = "approval.ended"
    TOOL_RESULT = "tool.result"
    CREDITS = "credits"
    SIGNAL = "signal"
    ERROR = "error"
    PONG = "pong"


class S2A:
    """Session server to agentd."""

    TASK_START = "task.start"
    TASK_STOP = "task.stop"
    TASK_PAUSE = "task.pause"
    TOOL_CALL = "tool.call"
    HANDOFF_RESUME = "handoff.resume"
    APPROVAL_ANSWER = "approval.answer"
    API_RESULT = "api.result"
    SIGNAL = "signal"
    VM_STATUS = "vm.status"

    ALL = frozenset(
        {
            TASK_START,
            TASK_STOP,
            TASK_PAUSE,
            TOOL_CALL,
            HANDOFF_RESUME,
            APPROVAL_ANSWER,
            API_RESULT,
            SIGNAL,
            VM_STATUS,
        }
    )


class A2S:
    """agentd to session server."""

    HELLO = "hello"
    TASK_STARTED = "task.started"
    TASK_STOPPED = "task.stopped"
    TOOL_RESULT = "tool.result"
    EVENT = "event"
    SIGNAL = "signal"
    VM_STATE = "vm.state"
    LOG = "log"

    ALL = frozenset({HELLO, TASK_STARTED, TASK_STOPPED, TOOL_RESULT, EVENT, SIGNAL, VM_STATE, LOG})


class EventKind:
    """``kind`` values of an ``A2S.EVENT``. Raised by agentlib or by a tool."""

    SAY = "say"
    PROGRESS = "progress"
    SHOW = "show"
    HANDOFF_REQUEST = "handoff.request"
    APPROVAL_REQUEST = "approval.request"
    API_REQUEST = "api.request"

    ALL = frozenset({SAY, PROGRESS, SHOW, HANDOFF_REQUEST, APPROVAL_REQUEST, API_REQUEST})


class LIB:
    """agentlib to agentd, one JSON object per line. ``op`` names the call."""

    SAY = "say"
    PROGRESS = "progress"
    SHOW = "show"
    REQUEST_APPROVAL = "request_approval"
    API = "api"
    HANDOFF = "handoff"

    ALL = frozenset({SAY, PROGRESS, SHOW, REQUEST_APPROVAL, API, HANDOFF})
    # These block the kernel until the server answers.
    BLOCKING = frozenset({REQUEST_APPROVAL, API, HANDOFF})


# Voice-model tools. Declared NON_BLOCKING; each returns at once.
VOICE_TOOLS = ("start_job", "check_job", "cancel_job", "show")

# Smart-model tools. python and computer run on the VM. show and handoff
# are handled by the server.
SMART_TOOLS = ("python", "computer", "show", "handoff")

# Actions that need approval before they run (design spec, Approvals).
GATED_ACTIONS = ("send", "buy", "delete", "post", "share", "account_change")

# Delimiters that wrap every tool result that came from outside the system.
EXTERNAL_OPEN = "<<<EXTERNAL_DATA"
EXTERNAL_CLOSE = "EXTERNAL_DATA>>>"


class JobStatus:
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"  # waiting on a handoff, an approval, or credits
    DONE = "done"
    FAILED = "failed"
    NEEDS_USER = "needs_user"
    CANCELLED = "cancelled"

    TERMINAL = frozenset({DONE, FAILED, NEEDS_USER, CANCELLED})


class HandoffOutcome:
    DONE = "done"
    CANCEL = "cancel"
    TIMEOUT = "timeout"

    ALL = frozenset({DONE, CANCEL, TIMEOUT})


class CreditsState:
    OK = "ok"
    LOW = "low"
    OUT = "out"


# --------------------------------------------------------------------------- #
# Job result contract
# --------------------------------------------------------------------------- #


@dataclass
class JobResult:
    """What the smart model returns at the end of a job.

    The voice model speaks ``say`` with almost no change. ``show`` goes to
    the screen. ``artifacts`` are paths on the VM.
    """

    status: str
    say: str
    show: str | None = None
    artifacts: list[str] = field(default_factory=list)

    VALID_STATUS = frozenset({"done", "failed", "needs_user"})

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        if d["show"] is None:
            del d["show"]
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> JobResult:
        status = d.get("status")
        say = d.get("say")
        if status not in cls.VALID_STATUS:
            raise ProtocolError(
                f"result.status must be one of {sorted(cls.VALID_STATUS)}, got {status!r}"
            )
        if not isinstance(say, str) or not say.strip():
            raise ProtocolError("result.say must be a non-empty string")
        show = d.get("show")
        if show is not None and not isinstance(show, str):
            raise ProtocolError("result.show must be a string")
        artifacts = d.get("artifacts") or []
        if not isinstance(artifacts, list) or not all(isinstance(a, str) for a in artifacts):
            raise ProtocolError("result.artifacts must be a list of strings")
        return cls(status=status, say=say.strip(), show=show, artifacts=list(artifacts))

    @classmethod
    def failed(cls, say: str) -> JobResult:
        return cls(status="failed", say=say)


def extract_result(text: str) -> JobResult | None:
    """Find the result contract in a model's final text.

    Accepts a bare JSON object or one inside a ``json`` fence. Returns None
    when the text holds no object with the contract shape.
    """
    candidates: list[str] = []
    fence = "```"
    if fence in text:
        parts = text.split(fence)
        for i in range(1, len(parts), 2):
            body = parts[i]
            if body.startswith("json"):
                body = body[4:]
            candidates.append(body.strip())
    candidates.append(text.strip())
    # Also try the last {...} span, for text that ends with the object.
    start, end = text.rfind("{"), text.rfind("}")
    if 0 <= start < end:
        # Walk back to the outermost brace that still parses.
        depth = 0
        for i in range(end, -1, -1):
            if text[i] == "}":
                depth += 1
            elif text[i] == "{":
                depth -= 1
                if depth == 0:
                    candidates.append(text[i : end + 1])
                    break
    for c in candidates:
        try:
            obj = json.loads(c)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and "status" in obj and "say" in obj:
            try:
                return JobResult.from_dict(obj)
            except ProtocolError:
                continue
    return None


# --------------------------------------------------------------------------- #
# Parsing and helpers
# --------------------------------------------------------------------------- #

# Required fields per link. The same type name can carry a different shape
# on a different link (``tool.call`` from a client vs. to agentd), so the
# tables are keyed by link, never merged.
_REQUIRED: dict[str, dict[str, dict[str, type | tuple[type, ...]]]] = {
    "C2S": {
        C2S.HELLO: {"device": str},
        C2S.TRANSCRIPT: {"role": str, "text": str},
        C2S.TOOL_CALL: {"call_id": str, "name": str, "args": dict},
        C2S.HANDOFF_DONE: {"handoff_id": str},
        C2S.HANDOFF_CANCEL: {"handoff_id": str},
        C2S.APPROVAL_ANSWER: {"approval_id": str, "approved": bool},
        C2S.LIVE_RESUMPTION: {"handle": str},
        C2S.SIGNAL: {"handoff_id": str, "payload": dict},
        C2S.PUSH_REGISTER: {"platform": str, "token": str},
    },
    "S2A": {
        S2A.TASK_START: {"task_id": str, "job_id": str, "request": str, "budget": dict},
        S2A.TASK_STOP: {"task_id": str},
        S2A.TASK_PAUSE: {"task_id": str, "handoff_id": str},
        S2A.TOOL_CALL: {"id": str, "task_id": str, "name": str, "args": dict},
        S2A.HANDOFF_RESUME: {"task_id": str, "handoff_id": str, "outcome": str},
        S2A.APPROVAL_ANSWER: {"task_id": str, "approval_id": str, "approved": bool},
        S2A.API_RESULT: {"task_id": str, "request_id": str, "ok": bool},
        S2A.SIGNAL: {"handoff_id": str, "payload": dict},
    },
    "A2S": {
        A2S.HELLO: {"vm_id": str, "user_id": str, "auth": str},
        A2S.TASK_STARTED: {"task_id": str},
        A2S.TASK_STOPPED: {"task_id": str},
        A2S.TOOL_RESULT: {"id": str, "task_id": str, "ok": bool},
        A2S.EVENT: {"task_id": str, "kind": str, "payload": dict},
        A2S.SIGNAL: {"handoff_id": str, "payload": dict},
        A2S.LOG: {"level": str, "message": str},
    },
}
_LINK_BY_ALLOWED = {C2S.ALL: "C2S", S2A.ALL: "S2A", A2S.ALL: "A2S"}


def parse(raw: str | bytes | dict[str, Any], allowed: frozenset[str]) -> dict[str, Any]:
    """Decode and check one inbound message.

    ``allowed`` is the set of type names legal on this link, for example
    ``C2S.ALL``. Required fields are checked by name and type. Extra
    fields pass through; a handler ignores what it does not know.
    """
    if isinstance(raw, dict):
        msg = raw
    else:
        try:
            msg = json.loads(raw)
        except (json.JSONDecodeError, TypeError) as e:
            raise ProtocolError(f"not JSON: {e}") from None
    if not isinstance(msg, dict):
        raise ProtocolError("message must be a JSON object")
    t = msg.get("type")
    if t not in allowed:
        raise ProtocolError(f"unknown message type {t!r}")
    link = _LINK_BY_ALLOWED.get(allowed)
    if link is None:
        raise ProtocolError("allowed must be C2S.ALL, S2A.ALL or A2S.ALL")
    for key, typ in _REQUIRED[link].get(t, {}).items():
        if key not in msg:
            raise ProtocolError(f"{t}: missing field {key!r}")
        if not isinstance(msg[key], typ):
            raise ProtocolError(f"{t}: field {key!r} must be {getattr(typ, '__name__', typ)}")
    return msg


def msg(type_: str, **fields: Any) -> dict[str, Any]:
    """Build an outbound message. ``None`` values are dropped."""
    out: dict[str, Any] = {"type": type_}
    for k, v in fields.items():
        if v is not None:
            out[k] = v
    return out


def dumps(message: dict[str, Any]) -> str:
    return json.dumps(message, separators=(",", ":"), ensure_ascii=False)


def wrap_external(text: str, source: str) -> str:
    """Mark text that came from outside the system as data, never instruction."""
    body = text.replace(EXTERNAL_CLOSE, "EXTERNAL_DATA>> >")
    return f"{EXTERNAL_OPEN} source={source}\n{body}\n{EXTERNAL_CLOSE}"
