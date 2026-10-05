"""Demo mode: a scripted smart model for showing the product without a key.

Each job runs the same short story through the real loop and a real agentd:
a python step that writes report.csv and reports progress, a show step and the
result contract. "approve" in the request adds an approval inside the python
step; "login" starts with a handoff. Selected with ``APPARATUS_DEMO=1``.
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Any

from .model import FakeSmartModel, FunctionCall, ModelReply, Usage

ROWS = [("North", 42, 1260), ("South", 35, 1050), ("West", 28, 840)]

REPORT = "\n".join(
    [
        "## Weekly orders",
        "",
        "| Region | Orders | Revenue |",
        "|---|---|---|",
        *(f"| {r} | {o} | ${v:,} |" for r, o, v in ROWS),
        "",
        "- North leads with 42 orders.",
        "- West trails North by 14 orders.",
        "- The full table is in report.csv.",
    ]
)

_APPROVAL = (
    "approved = agentlib.request_approval("
    '"send", {"to": "dana@example.com", "subject": "Thursday"})\n'
    'print("APPROVAL:", "approved" if approved else "declined")\n'
)

_TABLE = f"""agentlib.progress("Reading the source", percent=40)
rows = [("Region", "Orders", "Revenue"), *{ROWS!r}]
with open("report.csv", "w", newline="") as f:
    csv.writer(f).writerows(rows)
for region, orders, revenue in rows:
    print(f"{{region:<8}}{{orders:>8}}{{revenue:>10}}")
"""


def _code(approve: bool) -> str:
    head = "# Read the source and write report.csv\nimport csv\nimport agentlib\n"
    return head + (_APPROVAL if approve else "") + _TABLE


def _call(name: str, args: dict[str, Any]) -> ModelReply:
    return ModelReply(calls=[FunctionCall(uuid.uuid4().hex[:8], name, args)], usage=Usage(1200, 80))


def _say(approve: bool, tool_text: str) -> str:
    if not approve:
        return "The report is ready. North leads with 42 orders, and the table is on your screen."
    if "APPROVAL: approved" in tool_text:
        return (
            "I sent the Thursday note to Dana. The report is ready and North leads with 42 orders."
        )
    return "I held the Thursday note to Dana. The report is ready and North leads with 42 orders."


def _script(history: list[dict[str, Any]]) -> ModelReply:
    first = " ".join(p.get("text", "") for p in history[0].get("parts", []))
    head, _, _ = first.partition("\n\nTask id: ")
    request = head.lower()
    m = re.search(r"Task id: (\S+?)\. Working folder", first)
    task = m.group(1) if m else "demo"
    done: list[str] = []
    tool_text = ""
    for turn in history[1:]:
        for part in turn.get("parts", []):
            fr = part.get("function_response")
            if fr:
                done.append(fr.get("name", ""))
                tool_text += json.dumps(fr.get("response", {}))
    approve = "approve" in request
    if "login" in request and "handoff" not in done:
        return _call(
            "handoff", {"reason": "Sign in to the reports site", "url": "https://example.com/login"}
        )
    if "python" not in done:
        return _call("python", {"code": _code(approve)})
    if "show" not in done:
        return _call("show", {"content": REPORT})
    result = {
        "status": "done",
        "say": _say(approve, tool_text),
        "show": REPORT,
        "artifacts": [f"/home/agent/tasks/{task}/report.csv"],
    }
    return ModelReply(text=json.dumps(result), usage=Usage(1400, 120))


def demo_model() -> FakeSmartModel:
    return FakeSmartModel(_script)
