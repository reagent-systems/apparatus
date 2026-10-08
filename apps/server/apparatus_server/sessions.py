"""Conversation memory across Live sessions: a rolling summary per user
and the latest resumption handle. A Live session has a time limit; the
next one starts with the summary in its system instruction."""

from __future__ import annotations

import logging
import time
from typing import Any, Protocol

from .model import SmartModel
from .store import Store

log = logging.getLogger("apparatus.sessions")
COLLECTION = "sessions"

SUMMARY_PROMPT = """Summarize the conversation below for the next session of a voice assistant.
Keep: what the user asked for, what was done, open items, names and numbers the user gave.
Drop: greetings, filler, anything the assistant said that the user did not use.
Write at most {max_chars} characters of plain prose. No lists, no markdown.

Earlier summary:
{summary}

New transcript:
{transcript}
"""


class Summarizer(Protocol):
    async def summarize(self, summary: str, transcript: str, max_chars: int) -> str: ...


class NaiveSummarizer:
    """Keeps the newest lines when no model is available."""

    async def summarize(self, summary: str, transcript: str, max_chars: int) -> str:
        text = (summary + "\n" + transcript).strip()
        return text[-max_chars:]


class ModelSummarizer:
    def __init__(self, model: SmartModel, model_name: str):
        self.model = model
        self.model_name = model_name

    async def summarize(self, summary: str, transcript: str, max_chars: int) -> str:
        prompt = SUMMARY_PROMPT.format(
            max_chars=max_chars, summary=summary or "(none)", transcript=transcript
        )
        try:
            reply = await self.model.generate(
                model=self.model_name,
                system="You write short, exact summaries.",
                history=[{"role": "user", "parts": [{"text": prompt}]}],
                tools=[],
            )
            text = reply.text.strip()
            return text[:max_chars] if text else summary
        except Exception as e:  # noqa: BLE001 - a failed summary must not lose the session
            log.warning("summary failed: %s", e)
            return (summary + "\n" + transcript).strip()[-max_chars:]


class Sessions:
    def __init__(
        self, store: Store, summarizer: Summarizer, max_chars: int = 2000, fold_at_chars: int = 6000
    ):
        self.store = store
        self.summarizer = summarizer
        self.max_chars = max_chars
        self.fold_at = fold_at_chars

    async def _doc(self, user_id: str) -> dict[str, Any]:
        return await self.store.get(COLLECTION, user_id) or {
            "user_id": user_id,
            "summary": "",
            "transcript": "",
            "resumption_handle": None,
            "updated": 0,
        }

    async def summary(self, user_id: str) -> str | None:
        doc = await self._doc(user_id)
        text = (doc["summary"] + "\n" + doc["transcript"]).strip()
        return text[-self.max_chars :] if text else None

    async def add_transcript(self, user_id: str, role: str, text: str) -> None:
        text = text.strip()
        if not text:
            return
        doc = await self._doc(user_id)
        doc["transcript"] += f"{role}: {text}\n"
        doc["updated"] = time.time()
        if len(doc["transcript"]) > self.fold_at:
            doc["summary"] = await self.summarizer.summarize(
                doc["summary"], doc["transcript"], self.max_chars
            )
            doc["transcript"] = ""
        await self.store.put(COLLECTION, user_id, doc)

    async def note_event(self, user_id: str, text: str) -> None:
        """A job result or a handoff, so the next session knows it happened."""
        await self.add_transcript(user_id, "system", text)

    async def set_resumption_handle(self, user_id: str, handle: str | None) -> None:
        doc = await self._doc(user_id)
        doc["resumption_handle"] = handle
        await self.store.put(COLLECTION, user_id, doc)

    async def resumption_handle(self, user_id: str) -> str | None:
        return (await self._doc(user_id)).get("resumption_handle")
