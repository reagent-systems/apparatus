"""Append-only audit log on the server.

Every tool call, approval and handoff lands here. The user can read it.
The agent cannot change it: nothing in the VM has a path to this store.
"""

from __future__ import annotations

import time
from typing import Any

from .store import Store

COLLECTION = "audit"


class Audit:
    def __init__(self, store: Store):
        self.store = store

    async def record(self, user_id: str, kind: str, **fields: Any) -> dict[str, Any]:
        entry = {"t": round(time.time(), 3), "kind": kind, **_trim(fields)}
        await self.store.append(COLLECTION, user_id, entry)
        return entry

    async def read(self, user_id: str, limit: int = 500) -> list[dict[str, Any]]:
        rows = await self.store.entries(COLLECTION, user_id)
        return rows[-limit:]


def _trim(fields: dict[str, Any], limit: int = 4000) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in fields.items():
        if isinstance(v, str) and len(v) > limit:
            v = v[:limit] + f"...[{len(v) - limit} more]"
        elif isinstance(v, dict):
            v = _trim(v, limit)
        out[k] = v
    return out
