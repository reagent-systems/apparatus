"""Connected client devices for each user, and who holds the voice session."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from apparatus_protocol import S2C, msg

from .store import Store

log = logging.getLogger("apparatus.clients")
Send = Callable[[dict[str, Any]], Awaitable[None]]
PUSH = "push_tokens"


@dataclass
class ClientConn:
    user_id: str
    device: str
    send: Send
    device_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    connected_at: float = field(default_factory=time.time)
    wants_voice: bool = False


class ClientHub:
    def __init__(self, store: Store):
        self.store = store
        self.conns: dict[str, dict[str, ClientConn]] = {}
        self.voice_holder: dict[str, str] = {}
        self.last_activity: dict[str, float] = {}

    # ---------------------------------------------------------------- #

    def attach(self, conn: ClientConn) -> None:
        self.conns.setdefault(conn.user_id, {})[conn.device_id] = conn
        self.touch(conn.user_id)

    def detach(self, conn: ClientConn) -> str | None:
        """Remove the device. Returns the user id if the voice session is now free."""
        devices = self.conns.get(conn.user_id, {})
        devices.pop(conn.device_id, None)
        if not devices:
            self.conns.pop(conn.user_id, None)
        self.touch(conn.user_id)
        if self.voice_holder.get(conn.user_id) == conn.device_id:
            del self.voice_holder[conn.user_id]
            return conn.user_id
        return None

    def touch(self, user_id: str) -> None:
        self.last_activity[user_id] = time.time()

    def has_session(self, user_id: str) -> bool:
        return bool(self.conns.get(user_id))

    def devices(self, user_id: str) -> list[ClientConn]:
        return list(self.conns.get(user_id, {}).values())

    # ---------------------------------------------------------------- #
    # voice session: one device at a time
    # ---------------------------------------------------------------- #

    async def claim_voice(self, conn: ClientConn) -> None:
        old = self.voice_holder.get(conn.user_id)
        self.voice_holder[conn.user_id] = conn.device_id
        if old and old != conn.device_id:
            await self.send_to(conn.user_id, old, msg(S2C.VOICE_REVOKED, by=conn.device_id))
        await conn.send(msg(S2C.VOICE_GRANTED))

    async def release_voice(self, conn: ClientConn) -> None:
        if self.voice_holder.get(conn.user_id) == conn.device_id:
            del self.voice_holder[conn.user_id]

    def holds_voice(self, conn: ClientConn) -> bool:
        return self.voice_holder.get(conn.user_id) == conn.device_id

    # ---------------------------------------------------------------- #
    # delivery
    # ---------------------------------------------------------------- #

    async def broadcast(self, user_id: str, m: dict[str, Any]) -> int:
        """Send to every device of the user. The ``voice`` field reaches only the voice holder."""
        n = 0
        holder = self.voice_holder.get(user_id)
        for conn in self.devices(user_id):
            out = (
                m
                if conn.device_id == holder or "voice" not in m
                else {k: v for k, v in m.items() if k != "voice"}
            )
            try:
                await conn.send(out)
                n += 1
            except Exception as e:  # noqa: BLE001 - a dead socket is detached by its own handler
                log.debug("send to %s failed: %s", conn.device_id, e)
        return n

    async def send_to(self, user_id: str, device_id: str, m: dict[str, Any]) -> bool:
        conn = self.conns.get(user_id, {}).get(device_id)
        if conn is None:
            return False
        try:
            await conn.send(m)
            return True
        except Exception:  # noqa: BLE001
            return False

    # ---------------------------------------------------------------- #
    # push tokens
    # ---------------------------------------------------------------- #

    async def register_push(self, user_id: str, device_id: str, platform: str, token: str) -> None:
        doc = await self.store.get(PUSH, user_id) or {"user_id": user_id, "devices": {}}
        doc["devices"][device_id] = {"platform": platform, "token": token, "t": time.time()}
        # One token per device; drop old registrations of the same token.
        for did in [d for d, v in doc["devices"].items() if v["token"] == token and d != device_id]:
            del doc["devices"][did]
        await self.store.put(PUSH, user_id, doc)

    async def push_tokens(self, user_id: str) -> list[str]:
        doc = await self.store.get(PUSH, user_id)
        return [v["token"] for v in (doc or {}).get("devices", {}).values()]


async def gather_quietly(*coros: Awaitable[Any]) -> None:
    await asyncio.gather(*coros, return_exceptions=True)
