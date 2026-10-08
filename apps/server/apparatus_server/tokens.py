"""Ephemeral Live tokens. The API key stays here; the client gets a token
that works for one session, for a short time, with the model and setup
locked by the server."""

from __future__ import annotations

import itertools
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol


@dataclass(frozen=True)
class Token:
    name: str
    expire_time: datetime
    new_session_expire_time: datetime


class TokenMinter(Protocol):
    async def mint(
        self,
        *,
        model: str,
        live_config: dict[str, Any],
        new_session_seconds: int,
        expire_seconds: int,
    ) -> Token: ...


class FakeTokenMinter:
    """Development and tests. Produces tokens no API accepts."""

    def __init__(self) -> None:
        self._n = itertools.count(1)
        self.minted: list[dict[str, Any]] = []

    async def mint(
        self,
        *,
        model: str,
        live_config: dict[str, Any],
        new_session_seconds: int,
        expire_seconds: int,
    ) -> Token:
        now = datetime.now(UTC)
        self.minted.append({"model": model, "live_config": live_config})
        return Token(
            name=f"auth_tokens/fake-{next(self._n)}",
            expire_time=now + timedelta(seconds=expire_seconds),
            new_session_expire_time=now + timedelta(seconds=new_session_seconds),
        )


class GeminiTokenMinter:
    """``client.aio.auth_tokens.create`` on the v1alpha API."""

    def __init__(self, api_key: str):
        if not api_key:
            raise ValueError("GEMINI_API_KEY is empty")
        from google import genai

        self.client = genai.Client(api_key=api_key, http_options={"api_version": "v1alpha"})

    async def mint(
        self,
        *,
        model: str,
        live_config: dict[str, Any],
        new_session_seconds: int,
        expire_seconds: int,
    ) -> Token:
        now = datetime.now(UTC)
        expire = now + timedelta(seconds=expire_seconds)
        new_session = now + timedelta(seconds=new_session_seconds)
        token = await self.client.aio.auth_tokens.create(
            config={
                "uses": 1,
                "expire_time": expire,
                "new_session_expire_time": new_session,
                "live_connect_constraints": {"model": model, "config": live_config},
                # The client may add nothing but the resumption handle.
                "lock_additional_fields": [
                    "system_instruction",
                    "tools",
                    "response_modalities",
                    "realtime_input_config",
                ],
            }
        )
        return Token(
            name=str(token.name),
            expire_time=token.expire_time or expire,
            new_session_expire_time=token.new_session_expire_time or new_session,
        )


def make_token_minter(api_key: str) -> TokenMinter:
    return GeminiTokenMinter(api_key) if api_key else FakeTokenMinter()
