"""Demo mode: a scripted smart model for showing the product without a key.

Each job runs one short story through the real loop and a real agentd: one
python step that reports its progress, writes a CSV under ~/reports and prints
it, then the result contract with its own say, show and artifact. The request
picks the story: "approve" sends Dana the weekly orders after an approval,
"login" starts with a handoff and gets the export, "compare" or "last week"
compares two weeks, "revenue" ranks the regions by revenue, anything else
builds the weekly orders table. Selected with ``APPARATUS_DEMO=1``.
"""

from __future__ import annotations

import datetime as dt
import json
import uuid
from dataclasses import dataclass
from typing import Any

from .model import FakeSmartModel, FunctionCall, ModelReply, Usage

# Region, orders last week, orders this week, revenue this week.
ROWS = [("North", 36, 42, 1260), ("South", 33, 35, 1050), ("West", 27, 28, 840)]
DANA = "dana@larkspur.example"
REPORTS = "/home/agent/reports"


@dataclass(frozen=True)
class Story:
    file: str
    header: tuple[str, ...]
    rows: list[tuple[Any, ...]]
    steps: tuple[str, ...]
    show: str
    say: str
    # The CSV's rows: plain numbers, no currency signs or thousands separators.
    data: list[tuple[Any, ...]]


def _table(
    title: str, header: tuple[str, ...], rows: list[tuple[Any, ...]], notes: list[str]
) -> str:
    return "\n".join(
        [
            f"## {title}",
            "",
            "| " + " | ".join(header) + " |",
            "|" + "---|" * len(header),
            *("| " + " | ".join(str(c) for c in r) + " |" for r in rows),
            "",
            *(f"- {n}" for n in notes),
        ]
    )


def _orders(short: bool) -> Story:
    header = ("Region", "Orders", "Revenue")
    rows = [(r, o, f"${v:,}") for r, _, o, v in ROWS]
    say = (
        "North had the most orders this week, 42."
        if short
        else "North leads with 42 orders this week. The table is in report.csv."
    )
    return Story(
        "report.csv",
        header,
        rows,
        ("Opening orders.csv", "Grouping by region", "Writing report.csv"),
        _table(
            "Weekly orders",
            header,
            rows,
            [
                "North leads with 42 orders.",
                "West trails North by 14 orders.",
                "The full table is in report.csv.",
            ],
        ),
        say,
        [(r, o, v) for r, _, o, v in ROWS],
    )


def _compare() -> Story:
    header = ("Region", "Last week", "This week", "Change")
    rows = [(r, a, b, f"+{b - a}") for r, a, b, _ in ROWS]
    return Story(
        "compare.csv",
        header,
        rows,
        (
            "Opening orders.csv",
            "Opening last week's orders",
            "Comparing the two weeks",
            "Writing compare.csv",
        ),
        _table(
            "This week against last week",
            header,
            rows,
            [
                "Orders rose from 96 to 105.",
                "North grew the most, up 6.",
                "The table is in compare.csv.",
            ],
        ),
        "Orders rose from 96 to 105 this week. North grew the most, up 6.",
        [(r, a, b, b - a) for r, a, b, _ in ROWS],
    )


def _revenue() -> Story:
    header = ("Region", "Revenue", "Share")
    total = sum(v for *_, v in ROWS)
    rows = [(r, f"${v:,}", f"{round(100 * v / total)}%") for r, _, _, v in ROWS]
    return Story(
        "revenue.csv",
        header,
        rows,
        ("Opening orders.csv", "Adding up revenue by region", "Writing revenue.csv"),
        _table(
            "Revenue by region",
            header,
            rows,
            [f"The three regions brought in ${total:,}.", "The table is in revenue.csv."],
        ),
        "North brought in the most revenue, $1,260 this week. South follows with $1,050.",
        [(r, v, round(100 * v / total)) for r, _, _, v in ROWS],
    )


def _export() -> Story:
    header = ("Region", "Orders", "Revenue")
    rows = [(r, o, f"${v:,}") for r, _, o, v in ROWS]
    return Story(
        "export.csv",
        header,
        rows,
        ("Opening the reports site", "Downloading the export", "Writing export.csv"),
        _table(
            "Reports site export",
            header,
            rows,
            ["105 orders this week.", "The export is in export.csv."],
        ),
        "The export is in export.csv. It holds 105 orders.",
        [(r, o, v) for r, _, o, v in ROWS],
    )


def _week(today: dt.date | None = None) -> str:
    """The 7 days that end yesterday, as "29 Sep - 5 Oct"."""
    end = (today or dt.date.today()) - dt.timedelta(days=1)
    start = end - dt.timedelta(days=6)
    return f"{start.day} {start:%b} - {end.day} {end:%b}"


def _story(request: str) -> Story:
    if "login" in request:
        return _export()
    if "approve" in request:
        return _orders(short=False)
    if "compare" in request or "last week" in request:
        return _compare()
    if "revenue" in request:
        return _revenue()
    return _orders(short="most" in request)


def _code(story: Story, approve: bool) -> str:
    lines = [
        f"# {story.show.splitlines()[0].removeprefix('## ')}",
        "import csv",
        "import os",
        "import agentlib",
    ]
    if approve:
        details = {"to": DANA, "subject": f"Weekly orders, {_week()}", "attachment": story.file}
        lines += [
            f"approved = agentlib.request_approval({'Send email'!r}, {details!r})",
            'print("APPROVAL:", "approved" if approved else "declined")',
        ]
    steps = story.steps + (("Sending the email",) if approve else ())
    for i, step in enumerate(steps):
        percent = round(100 * (i + 1) / (len(steps) + 1))
        guard = "if approved: " if step == "Sending the email" else ""
        lines.append(f"{guard}agentlib.progress({step!r}, percent={percent})")
        if step.startswith("Writing "):
            lines += [
                'os.makedirs(os.path.expanduser("~/reports"), exist_ok=True)',
                f'with open(os.path.expanduser("~/reports/{story.file}"), "w", newline="") as f:',
                f'    csv.writer(f, lineterminator="\\n").writerows([{story.header!r}, *{story.data!r}])',
            ]
    lines.append(f"print(open(os.path.expanduser('~/reports/{story.file}')).read())")
    return "\n".join(lines) + "\n"


def _call(name: str, args: dict[str, Any]) -> ModelReply:
    return ModelReply(calls=[FunctionCall(uuid.uuid4().hex[:8], name, args)], usage=Usage(1200, 80))


def _say(story: Story, approve: bool, tool_text: str) -> str:
    if not approve:
        return story.say
    if "APPROVAL: approved" in tool_text:
        return f"I sent Dana the weekly orders with {story.file} attached."
    return f"I did not send the email to Dana. The table is in {story.file}."


def _script(history: list[dict[str, Any]]) -> ModelReply:
    first = " ".join(p.get("text", "") for p in history[0].get("parts", []))
    head, _, _ = first.partition("\n\nTask id: ")
    request = head.lower()
    done: list[str] = []
    tool_text = ""
    for turn in history[1:]:
        for part in turn.get("parts", []):
            fr = part.get("function_response")
            if fr:
                done.append(fr.get("name", ""))
                tool_text += json.dumps(fr.get("response", {}))
    story = _story(request)
    approve = "approve" in request
    if "login" in request and "handoff" not in done:
        return _call(
            "handoff",
            {
                "reason": "Sign in to the reports site",
                "url": "https://reports.larkspur.example/login",
            },
        )
    if "python" not in done:
        return _call("python", {"code": _code(story, approve)})
    result = {
        "status": "done",
        "say": _say(story, approve, tool_text),
        "show": story.show,
        "artifacts": [f"{REPORTS}/{story.file}"],
    }
    return ModelReply(text=json.dumps(result), usage=Usage(1400, 120))


def demo_model() -> FakeSmartModel:
    return FakeSmartModel(_script)
