"""Smart-model adapter. ``GeminiSmartModel`` calls generate_content with
explicit caching of the stable prefix. ``FakeSmartModel`` runs a script,
for tests and for development without a key."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

log = logging.getLogger("apparatus.model")


@dataclass(frozen=True)
class FunctionCall:
    id: str
    name: str
    args: dict[str, Any]


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0

    @property
    def total(self) -> int:
        return self.input_tokens + self.output_tokens


@dataclass
class ModelReply:
    text: str = ""
    calls: list[FunctionCall] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)

    def as_content(self) -> dict[str, Any]:
        """The model turn to append to the history."""
        parts: list[dict[str, Any]] = []
        if self.text:
            parts.append({"text": self.text})
        for c in self.calls:
            parts.append({"function_call": {"id": c.id, "name": c.name, "args": c.args}})
        return {"role": "model", "parts": parts or [{"text": ""}]}


class SmartModel(Protocol):
    async def generate(
        self, *, model: str, system: str, history: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> ModelReply: ...


Script = Callable[[list[dict[str, Any]]], ModelReply]


class FakeSmartModel:
    """Replies from a list, or from a function of the history."""

    def __init__(self, replies: list[ModelReply] | Script):
        self._replies = list(replies) if isinstance(replies, list) else None
        self._script = replies if callable(replies) else None
        self.calls: list[dict[str, Any]] = []

    async def generate(
        self, *, model: str, system: str, history: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> ModelReply:
        self.calls.append({"model": model, "history_len": len(history)})
        if self._script is not None:
            return self._script(history)
        assert self._replies is not None
        if not self._replies:
            return ModelReply(text='{"status": "failed", "say": "I ran out of scripted replies."}')
        return self._replies.pop(0)


class GeminiSmartModel:
    def __init__(self, api_key: str, cache_ttl_seconds: int = 3600, use_cache: bool = True):
        if not api_key:
            raise ValueError("GEMINI_API_KEY is empty")
        from google import genai

        self.client = genai.Client(api_key=api_key)
        self.cache_ttl = cache_ttl_seconds
        self.use_cache = use_cache
        self._caches: dict[str, str | None] = {}

    async def _cache_for(self, model: str, system: str, tools: list[dict[str, Any]]) -> str | None:
        """Cache the system prompt and tools once per model. None when caching is unavailable."""
        if not self.use_cache:
            return None
        key = f"{model}:{hash(system)}:{len(tools)}"
        if key in self._caches:
            return self._caches[key]
        try:
            cache = await self.client.aio.caches.create(
                model=model,
                config={
                    "system_instruction": system,
                    "tools": [{"function_declarations": tools}],
                    "ttl": f"{self.cache_ttl}s",
                    "display_name": "apparatus-smart-prefix",
                },
            )
            self._caches[key] = cache.name
        except Exception as e:  # noqa: BLE001 - small prompts are below the cache minimum; fall back
            log.info("context cache unavailable for %s: %s", model, e)
            self._caches[key] = None
        return self._caches[key]

    async def generate(
        self, *, model: str, system: str, history: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> ModelReply:
        cache_name = await self._cache_for(model, system, tools)
        config: dict[str, Any] = {"temperature": 0.2}
        if cache_name:
            config["cached_content"] = cache_name
        else:
            config["system_instruction"] = system
            config["tools"] = [{"function_declarations": tools}]
        response = await self.client.aio.models.generate_content(
            model=model, contents=history, config=config
        )
        return parse_response(response)


def parse_response(response: Any) -> ModelReply:
    """Turn a GenerateContentResponse into a ModelReply."""
    reply = ModelReply()
    candidates = getattr(response, "candidates", None) or []
    if candidates:
        content = getattr(candidates[0], "content", None)
        for part in getattr(content, "parts", None) or []:
            if getattr(part, "thought", False):
                continue
            fc = getattr(part, "function_call", None)
            if fc is not None:
                reply.calls.append(
                    FunctionCall(
                        id=getattr(fc, "id", None) or uuid.uuid4().hex,
                        name=fc.name,
                        args=dict(fc.args or {}),
                    )
                )
            elif getattr(part, "text", None):
                reply.text += part.text
    um = getattr(response, "usage_metadata", None)
    if um is not None:
        reply.usage = Usage(
            input_tokens=int(getattr(um, "prompt_token_count", 0) or 0),
            output_tokens=int(getattr(um, "candidates_token_count", 0) or 0)
            + int(getattr(um, "thoughts_token_count", 0) or 0),
            cached_tokens=int(getattr(um, "cached_content_token_count", 0) or 0),
        )
    return reply


def make_smart_model(
    api_key: str, fake: SmartModel | None = None, *, demo: bool = False
) -> SmartModel:
    if fake is not None:
        return fake
    if demo:
        from .demo import demo_model

        return demo_model()
    if api_key:
        return GeminiSmartModel(api_key)
    return FakeSmartModel(
        [
            ModelReply(
                text='{"status": "failed", "say": "No model key is configured on the server."}'
            )
        ]
    )
