"""Screen streams and desktop control.

A stream is one WebRTC session between a client device and the user's VM.
The server never carries video: it mints TURN credentials, keeps the
registry that says which device owns which stream, and holds who controls
the desktop. Signaling is relayed by ``main.py``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from .config import Settings

TURN_USER = "apparatus"


def turn_credentials(
    secret: str, ttl_seconds: int, now: float | None = None
) -> tuple[str, str, int]:
    """One coturn ``use-auth-secret`` credential: ``(username, credential, expiry)``.

    ``username`` is ``<unix expiry>:apparatus``. ``credential`` is
    base64(HMAC-SHA1(secret, username)).
    """
    expiry = int(time.time() if now is None else now) + int(ttl_seconds)
    username = f"{expiry}:{TURN_USER}"
    digest = hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()
    return username, base64.b64encode(digest).decode(), expiry


def ice_servers(settings: Settings, now: float | None = None) -> list[dict[str, Any]]:
    """A WebRTC ``RTCIceServer[]``: STUN always, TURN when the environment names one."""
    out: list[dict[str, Any]] = []
    if settings.stream.stun_url:
        out.append({"urls": [settings.stream.stun_url]})
    if settings.turn_url and settings.turn_secret:
        username, credential, _ = turn_credentials(
            settings.turn_secret, settings.stream.turn_ttl_seconds, now
        )
        out.append({"urls": [settings.turn_url], "username": username, "credential": credential})
    return out


@dataclass
class Stream:
    stream_id: str
    user_id: str
    device_id: str
    opened_at: float = field(default_factory=time.time)


@dataclass
class Control:
    active: bool = False
    by: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"active": self.active, "by": self.by}


class StreamRegistry:
    """Open streams keyed by stream id, and the control state per user."""

    def __init__(self) -> None:
        self.streams: dict[str, Stream] = {}
        self._control: dict[str, Control] = {}

    # ---------------------------------------------------------------- #
    # streams
    # ---------------------------------------------------------------- #

    def open(self, user_id: str, device_id: str) -> Stream:
        st = Stream(uuid.uuid4().hex[:12], user_id, device_id)
        self.streams[st.stream_id] = st
        return st

    def close(self, stream_id: str) -> Stream | None:
        return self.streams.pop(stream_id, None)

    def get(self, stream_id: str) -> Stream | None:
        return self.streams.get(stream_id)

    def owned(self, stream_id: str, user_id: str) -> Stream | None:
        """The stream when ``user_id`` owns it. A foreign id is as good as none."""
        st = self.streams.get(stream_id)
        return st if st is not None and st.user_id == user_id else None

    def for_device(self, user_id: str, device_id: str) -> list[Stream]:
        return [
            s for s in self.streams.values() if s.user_id == user_id and s.device_id == device_id
        ]

    def for_user(self, user_id: str) -> list[Stream]:
        return [s for s in self.streams.values() if s.user_id == user_id]

    # ---------------------------------------------------------------- #
    # control
    # ---------------------------------------------------------------- #

    def control(self, user_id: str) -> Control:
        return self._control.get(user_id, Control())

    def take(self, user_id: str, device_id: str) -> Control:
        c = Control(active=True, by=device_id)
        self._control[user_id] = c
        return c

    def release(self, user_id: str, device_id: str | None = None) -> Control | None:
        """Release when ``device_id`` holds control, or unconditionally with None.

        Returns the new state, or None when nothing changed.
        """
        c = self._control.get(user_id)
        if c is None or not c.active:
            return None
        if device_id is not None and c.by != device_id:
            return None
        self._control[user_id] = Control()
        return self._control[user_id]
