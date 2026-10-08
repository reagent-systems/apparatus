"""The Python session for one task. Started by agentd as a child process.

Protocol: one JSON object per line on stdin ``{"id", "code"}``; one JSON
object per line back ``{"id", "ok", "output", "error", "files"}``.

The protocol channel is a duplicate of the original stdout. During each
execution fd 1 and fd 2 point at a capture file, so prints and the output
of shell commands run from Python both land in ``output`` and never on
the protocol channel.
"""

from __future__ import annotations

import ast
import json
import os
import sys
import tempfile
import traceback
from pathlib import Path

MAX_FILES = 50
SKIP_DIRS = {"__pycache__", ".git", "node_modules", ".venv"}


def _snapshot(root: Path) -> dict[str, float]:
    out: dict[str, float] = {}
    if not root.exists():
        return out
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            p = Path(dirpath) / name
            if p.name in ("log.jsonl", "result.json"):
                continue
            try:
                out[str(p)] = p.stat().st_mtime
            except OSError:
                continue
    return out


def _run(code: str, ns: dict) -> str | None:
    """Execute ``code`` in ``ns``. Echo the value of a trailing expression."""
    tree = ast.parse(code, "<task>", "exec")
    last_expr = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last_expr = ast.Expression(tree.body[-1].value)
        tree.body = tree.body[:-1]
    if tree.body:
        exec(compile(tree, "<task>", "exec"), ns)
    if last_expr is not None:
        value = eval(compile(last_expr, "<task>", "eval"), ns)
        if value is not None:
            print(repr(value))
    return None


def main() -> None:
    proto_out = os.fdopen(os.dup(1), "w", buffering=1)
    proto_in = os.fdopen(os.dup(0), "r")
    workdir = Path(os.environ.get("AGENT_TASK_DIR", os.getcwd()))
    tools = os.environ.get("AGENT_TOOLS_DIR")
    if tools and tools not in sys.path:
        sys.path.insert(0, tools)
    ns: dict = {"__name__": "__main__", "__builtins__": __builtins__}
    max_chars = int(os.environ.get("AGENTD_MAX_OUTPUT_CHARS", "50000"))
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)  # user code must not read the protocol channel

    for line in proto_in:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        rid = req.get("id")
        code = req.get("code", "")
        before = _snapshot(workdir)
        ok, error = True, None
        with tempfile.TemporaryFile("w+b") as cap:
            os.dup2(cap.fileno(), 1)
            os.dup2(cap.fileno(), 2)
            sys.stdout = os.fdopen(os.dup(1), "w", buffering=1, errors="replace")
            sys.stderr = os.fdopen(os.dup(2), "w", buffering=1, errors="replace")
            try:
                _run(code, ns)
            except SystemExit as e:
                ok = False
                error = f"SystemExit: {e.code}"
            except BaseException:  # noqa: BLE001 - every error goes back to the model
                ok = False
                tb = traceback.format_exc()
                # Drop the frames from this file; the model only needs its own.
                error = "".join(
                    ln for ln in tb.splitlines(keepends=True) if "kernel_child.py" not in ln
                )
            finally:
                try:
                    sys.stdout.flush()
                    sys.stderr.flush()
                except Exception:  # noqa: BLE001
                    pass
                sys.stdout.close()
                sys.stderr.close()
                sys.stdout = sys.__stdout__
                sys.stderr = sys.__stderr__
            cap.flush()
            cap.seek(0)
            output = cap.read().decode("utf-8", errors="replace")
        if len(output) > max_chars:
            head, tail = max_chars * 2 // 3, max_chars // 3
            output = (
                output[:head]
                + f"\n...[{len(output) - head - tail} characters cut]...\n"
                + output[-tail:]
            )
        after = _snapshot(workdir)
        files = sorted(p for p, m in after.items() if before.get(p) != m)[:MAX_FILES]
        proto_out.write(
            json.dumps({"id": rid, "ok": ok, "output": output, "error": error, "files": files})
            + "\n"
        )
        proto_out.flush()


if __name__ == "__main__":
    main()
