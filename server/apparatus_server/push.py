"""Push notifications: handoff, approval and job-done alerts.

``LogPush`` writes a log line. ``FcmPush`` calls the Firebase Cloud
Messaging HTTP v1 API with a bearer token from ``token_provider`` (in
production: the Cloud Run service account through Application Default
Credentials). FCM delivers to Android, iOS (through APNs) and web.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

import httpx

log = logging.getLogger("apparatus.push")


class Push(Protocol):
    async def send(self, tokens: list[str], title: str, body: str, data: dict[str, str]) -> int: ...


class LogPush:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    async def send(self, tokens: list[str], title: str, body: str, data: dict[str, str]) -> int:
        self.sent.append({"tokens": list(tokens), "title": title, "body": body, "data": dict(data)})
        log.info("push to %d device(s): %s - %s %s", len(tokens), title, body, data)
        return len(tokens)


class FcmPush:
    def __init__(
        self,
        project_id: str,
        token_provider: Callable[[], Awaitable[str]],
        client: httpx.AsyncClient | None = None,
    ):
        self.url = f"https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"
        self.token_provider = token_provider
        self.client = client or httpx.AsyncClient(timeout=10)

    async def send(self, tokens: list[str], title: str, body: str, data: dict[str, str]) -> int:
        if not tokens:
            return 0
        bearer = await self.token_provider()
        ok = 0
        for token in tokens:
            message = {
                "message": {
                    "token": token,
                    "notification": {"title": title, "body": body},
                    "data": {k: str(v) for k, v in data.items()},
                    "android": {"priority": "high"},
                    "apns": {
                        "headers": {"apns-priority": "10"},
                        "payload": {"aps": {"sound": "default"}},
                    },
                }
            }
            try:
                r = await self.client.post(
                    self.url, json=message, headers={"Authorization": f"Bearer {bearer}"}
                )
                if r.status_code < 300:
                    ok += 1
                else:
                    log.warning("fcm %s: %s", r.status_code, r.text[:200])
            except httpx.HTTPError as e:
                log.warning("fcm error: %s", e)
        return ok


async def gce_metadata_token() -> str:
    """Access token of the service account that runs this server (Cloud Run, GCE)."""
    async with httpx.AsyncClient(timeout=5) as c:
        r = await c.get(
            "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
            headers={"Metadata-Flavor": "Google"},
        )
        r.raise_for_status()
        return str(r.json()["access_token"])


def make_push(kind: str, firebase_project_id: str) -> Push:
    if kind == "log":
        return LogPush()
    if kind == "fcm":
        if not firebase_project_id:
            raise ValueError("fcm push needs FIREBASE_PROJECT_ID")
        return FcmPush(firebase_project_id, gce_metadata_token)
    raise ValueError(f"unknown push adapter {kind!r}")
