"""The disk layout under the agent home (design spec, "Disk layout").

The VM keeps what lasts: files, logins, tools. Every path here is relative
to ``home`` so tests can use a temporary directory.
"""

from __future__ import annotations

from pathlib import Path

MEMORY_INDEX_SEED = (
    "# Memory index\n\nOne line for each note in notes/. Add lines; never rewrite old ones.\n"
)
TOOLS_INDEX_SEED = (
    "# Saved tools\n\n"
    "One line for each script in this folder: name, purpose, usage.\n"
    "Import a tool with `import <name>`; this folder is on sys.path.\n"
)


def memory_dir(home: Path) -> Path:
    return home / "memory"


def notes_dir(home: Path) -> Path:
    return home / "memory" / "notes"


def memory_index(home: Path) -> Path:
    return home / "memory" / "index.md"


def tools_dir(home: Path) -> Path:
    return home / "tools"


def tools_index(home: Path) -> Path:
    return home / "tools" / "index.md"


def tasks_dir(home: Path) -> Path:
    return home / "tasks"


def task_dir(home: Path, task_id: str) -> Path:
    if not task_id or "/" in task_id or task_id.startswith(".") or ".." in task_id:
        raise ValueError(f"bad task id {task_id!r}")
    return tasks_dir(home) / task_id


def sessions_dir(home: Path) -> Path:
    return home / "sessions"


def browser_profile(home: Path) -> Path:
    return home / "browser-profile"


def ensure_layout(home: Path) -> None:
    """Create every folder and seed the two index files. Idempotent."""
    for d in (
        notes_dir(home),
        tools_dir(home),
        tasks_dir(home),
        sessions_dir(home),
        browser_profile(home),
    ):
        d.mkdir(parents=True, exist_ok=True)
    if not memory_index(home).exists():
        memory_index(home).write_text(MEMORY_INDEX_SEED)
    if not tools_index(home).exists():
        tools_index(home).write_text(TOOLS_INDEX_SEED)


def read_index(path: Path, limit: int = 20000) -> str:
    try:
        text = path.read_text(errors="replace")
    except FileNotFoundError:
        return ""
    if len(text) > limit:
        return text[:limit] + f"\n...[{len(text) - limit} more characters]"
    return text
