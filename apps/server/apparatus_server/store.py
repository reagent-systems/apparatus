"""State storage: users, jobs, ledger, event log, summaries.

``Store`` is the adapter seam (agent-kit/docs/ADAPTERS.md). ``MemoryStore``
is the default and safe one. ``FileStore`` writes one JSON file per
collection under a data directory. A Firestore adapter implements the
same six methods.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Protocol


class Store(Protocol):
    async def get(self, collection: str, key: str) -> dict[str, Any] | None: ...
    async def put(self, collection: str, key: str, value: dict[str, Any]) -> None: ...
    async def delete(self, collection: str, key: str) -> None: ...
    async def list(self, collection: str) -> list[dict[str, Any]]: ...
    async def append(self, collection: str, key: str, entry: dict[str, Any]) -> None: ...
    async def entries(self, collection: str, key: str) -> list[dict[str, Any]]: ...


class MemoryStore:
    def __init__(self) -> None:
        self._docs: dict[str, dict[str, dict[str, Any]]] = {}
        self._logs: dict[str, dict[str, list[dict[str, Any]]]] = {}

    async def get(self, collection: str, key: str) -> dict[str, Any] | None:
        doc = self._docs.get(collection, {}).get(key)
        return json.loads(json.dumps(doc)) if doc is not None else None

    async def put(self, collection: str, key: str, value: dict[str, Any]) -> None:
        self._docs.setdefault(collection, {})[key] = json.loads(json.dumps(value))

    async def delete(self, collection: str, key: str) -> None:
        self._docs.get(collection, {}).pop(key, None)

    async def list(self, collection: str) -> list[dict[str, Any]]:
        return [json.loads(json.dumps(v)) for v in self._docs.get(collection, {}).values()]

    async def append(self, collection: str, key: str, entry: dict[str, Any]) -> None:
        self._logs.setdefault(collection, {}).setdefault(key, []).append(
            json.loads(json.dumps(entry))
        )

    async def entries(self, collection: str, key: str) -> list[dict[str, Any]]:
        return list(self._logs.get(collection, {}).get(key, []))


class FileStore:
    """JSON files: ``<dir>/<collection>/<key>.json`` and ``.jsonl`` for logs."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)
        self._lock = asyncio.Lock()

    def _doc(self, collection: str, key: str) -> Path:
        _check(collection)
        _check(key)
        return self.root / collection / f"{key}.json"

    def _log(self, collection: str, key: str) -> Path:
        _check(collection)
        _check(key)
        return self.root / collection / f"{key}.jsonl"

    async def get(self, collection: str, key: str) -> dict[str, Any] | None:
        p = self._doc(collection, key)
        return await asyncio.to_thread(_read_json, p)

    async def put(self, collection: str, key: str, value: dict[str, Any]) -> None:
        p = self._doc(collection, key)
        async with self._lock:
            await asyncio.to_thread(_write_json, p, value)

    async def delete(self, collection: str, key: str) -> None:
        p = self._doc(collection, key)
        async with self._lock:
            await asyncio.to_thread(_unlink, p)

    async def list(self, collection: str) -> list[dict[str, Any]]:
        _check(collection)
        d = self.root / collection
        return await asyncio.to_thread(_read_all, d)

    async def append(self, collection: str, key: str, entry: dict[str, Any]) -> None:
        p = self._log(collection, key)
        async with self._lock:
            await asyncio.to_thread(_append_line, p, entry)

    async def entries(self, collection: str, key: str) -> list[dict[str, Any]]:
        p = self._log(collection, key)
        return await asyncio.to_thread(_read_lines, p)


def _check(name: str) -> None:
    if not name or "/" in name or name.startswith(".") or ".." in name:
        raise ValueError(f"bad store name {name!r}")


def _read_json(p: Path) -> dict[str, Any] | None:
    try:
        return json.loads(p.read_text())
    except FileNotFoundError:
        return None


def _write_json(p: Path, value: dict[str, Any]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False))
    tmp.replace(p)


def _unlink(p: Path) -> None:
    try:
        p.unlink()
    except FileNotFoundError:
        pass


def _read_all(d: Path) -> list[dict[str, Any]]:
    if not d.exists():
        return []
    out = []
    for p in sorted(d.glob("*.json")):
        doc = _read_json(p)
        if doc is not None:
            out.append(doc)
    return out


def _append_line(p: Path, entry: dict[str, Any]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def _read_lines(p: Path) -> list[dict[str, Any]]:
    if not p.exists():
        return []
    out = []
    for line in p.read_text(encoding="utf-8").splitlines():
        if line.strip():
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def make_store(kind: str, data_dir: str) -> Store:
    if kind == "memory":
        return MemoryStore()
    if kind == "file":
        return FileStore(data_dir)
    raise ValueError(f"unknown store {kind!r}")
