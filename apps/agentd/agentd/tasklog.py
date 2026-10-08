"""Per-task append-only log and result file.

The kernel is working memory only. The log is what survives. agentd
restores a task's metadata from it after a restart; variables are gone and
the agent re-reads what it wrote to disk.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any


class TaskLog:
    def __init__(self, task_dir: Path):
        self.dir = task_dir
        self.path = task_dir / "log.jsonl"
        self.result_path = task_dir / "result.json"

    def append(self, kind: str, **fields: Any) -> dict[str, Any]:
        entry = {"t": round(time.time(), 3), "kind": kind, **fields}
        with self.path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return entry

    def entries(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        out = []
        with self.path.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    # A torn last line after a crash. Keep what parses.
                    continue
        return out

    def write_result(self, result: dict[str, Any]) -> None:
        tmp = self.result_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(result, ensure_ascii=False, indent=2))
        tmp.replace(self.result_path)

    def read_result(self) -> dict[str, Any] | None:
        if not self.result_path.exists():
            return None
        try:
            return json.loads(self.result_path.read_text())
        except json.JSONDecodeError:
            return None

    def restore(self) -> dict[str, Any]:
        """Rebuild task metadata from the log: start info, step count, last state."""
        state: dict[str, Any] = {"steps": 0, "started": None, "last": None, "paused": False}
        for e in self.entries():
            k = e.get("kind")
            if k == "task.start":
                state["started"] = e
            elif k == "tool.call":
                state["steps"] += 1
            elif k == "task.pause":
                state["paused"] = True
                state["handoff_id"] = e.get("handoff_id")
            elif k == "task.resume":
                state["paused"] = False
                state["handoff_id"] = None
            state["last"] = e
        return state
