"""Every message type in apparatus_protocol appears in agent-kit/docs/PROTOCOL.md."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "protocol"))
from apparatus_protocol import A2S, C2S, LIB, S2A, S2C, EventKind  # noqa: E402

root = Path(__file__).resolve().parents[2]
doc = (root / "agent-kit/docs/PROTOCOL.md").read_text()
missing = []
for cls in (C2S, S2C, S2A, A2S, EventKind, LIB):
    for name, value in vars(cls).items():
        if name.isupper() and isinstance(value, str) and name not in ("ALL", "BLOCKING"):
            if f"`{value}`" not in doc:
                missing.append(f"{cls.__name__}.{name} = {value!r}")
if missing:
    print("protocol types missing from agent-kit/docs/PROTOCOL.md:")
    print("\n".join(f"  {m}" for m in missing))
    sys.exit(1)
print("protocol documented: ok")
