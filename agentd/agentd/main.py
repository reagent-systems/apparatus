"""agentd entry point: one outbound WebSocket to the session server.

The VM has no inbound ports. agentd dials out, says hello, then relays
messages both ways. Outbound messages queue while the link is down, so a
server restart loses nothing.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import os
import random
import signal
from typing import Any

from apparatus_protocol import A2S, PROTOCOL_VERSION, dumps, msg

from .config import AgentdConfig
from .core import AgentdCore
from .desktop import make_backend
from .libserver import LibServer

log = logging.getLogger("agentd")


def enrollment_auth(secret: str, vm_id: str) -> str:
    """HMAC-SHA256 of the VM id. Proves "this VM is vm_id", nothing more."""
    return hmac.new(secret.encode(), vm_id.encode(), hashlib.sha256).hexdigest()


class Agentd:
    def __init__(self, cfg: AgentdConfig):
        self.cfg = cfg
        self.outbox: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        backend = make_backend(cfg.desktop, cfg.display, cfg.stream_width, cfg.stream_height)
        self.core = AgentdCore(cfg, backend, self.outbox.put)
        self.lib = LibServer(cfg.socket_path, self.core.lib_request)
        self.stopping = asyncio.Event()

    def hello(self) -> dict[str, Any]:
        return msg(
            A2S.HELLO,
            vm_id=self.cfg.vm_id,
            user_id=self.cfg.user_id,
            auth=enrollment_auth(self.cfg.enroll_secret, self.cfg.vm_id),
            version=PROTOCOL_VERSION,
            capabilities={"desktop": self.cfg.desktop != "fake", "python": True, "stream": True},
        )

    async def run(self) -> None:
        import websockets

        await self.lib.start()
        delay = self.cfg.reconnect_min_seconds
        try:
            while not self.stopping.is_set():
                try:
                    async with websockets.connect(
                        self.cfg.server_url, max_size=16 * 1024 * 1024
                    ) as ws:
                        log.info("connected to %s", self.cfg.server_url)
                        delay = self.cfg.reconnect_min_seconds
                        await ws.send(dumps(self.hello()))
                        await ws.send(dumps(self.core.vm_state()))
                        await self._pump(ws)
                except (TimeoutError, OSError) as e:
                    log.warning("link down: %s", e)
                except Exception as e:  # noqa: BLE001 - websockets raises its own hierarchy
                    if self.stopping.is_set():
                        break
                    log.warning("link closed: %s", e)
                if self.stopping.is_set():
                    break
                await asyncio.sleep(delay + random.uniform(0, delay / 2))
                delay = min(delay * 2, self.cfg.reconnect_max_seconds)
        finally:
            await self.core.shutdown()
            await self.lib.stop()

    async def _pump(self, ws: Any) -> None:
        async def sender() -> None:
            while True:
                m = await self.outbox.get()
                try:
                    await ws.send(dumps(m))
                except Exception:
                    # Put it back for the next link and let recv surface the error.
                    self.outbox.put_nowait(m)
                    raise

        async def receiver() -> None:
            async for raw in ws:
                await self.core.handle(raw)

        send_task = asyncio.ensure_future(sender())
        recv_task = asyncio.ensure_future(receiver())
        try:
            done, pending = await asyncio.wait(
                {send_task, recv_task}, return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()
            for t in done:
                t.result()
        finally:
            for t in (send_task, recv_task):
                if not t.done():
                    t.cancel()


def run() -> None:
    logging.basicConfig(
        level=os.environ.get("AGENTD_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    cfg = AgentdConfig.from_env()
    d = Agentd(cfg)
    loop = asyncio.new_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, d.stopping.set)
    try:
        loop.run_until_complete(d.run())
    finally:
        loop.close()


if __name__ == "__main__":
    run()
