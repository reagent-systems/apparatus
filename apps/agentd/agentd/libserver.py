"""Unix socket server for agentlib. One JSON line in, one JSON line out."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

log = logging.getLogger("agentd.lib")
Handler = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]


class LibServer:
    def __init__(self, path: Path, handler: Handler, mode: int = 0o660):
        self.path = path
        self.handler = handler
        self.mode = mode
        self._server: asyncio.AbstractServer | None = None

    async def start(self) -> None:
        if self.path.exists():
            self.path.unlink()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._server = await asyncio.start_unix_server(self._serve, path=str(self.path))
        os.chmod(self.path, self.mode)

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        if self.path.exists():
            self.path.unlink()

    async def _serve(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            line = await reader.readline()
            if not line:
                return
            try:
                req = json.loads(line)
                if not isinstance(req, dict):
                    raise ValueError("not an object")
            except (json.JSONDecodeError, ValueError) as e:
                reply: dict[str, Any] = {"ok": False, "error": f"bad request: {e}"}
            else:
                reply = await self.handler(req)
            writer.write((json.dumps(reply) + "\n").encode())
            await writer.drain()
        except (ConnectionResetError, BrokenPipeError):
            pass
        except Exception:  # noqa: BLE001 - one bad client must not stop the server
            log.exception("lib request failed")
        finally:
            writer.close()
