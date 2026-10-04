"""Every field in config/apparatus.toml appears in agent-kit/docs/CONFIGURATION.md,
and every field the server reads has a line in the TOML. An undocumented
option is a defect."""

import sys
import tomllib
from dataclasses import fields
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "server"))
from apparatus_server import config as cfg  # noqa: E402

root = Path(__file__).resolve().parents[2]
toml = tomllib.loads((root / "config/apparatus.toml").read_text())
doc = (root / "agent-kit/docs/CONFIGURATION.md").read_text()

missing_doc, missing_toml = [], []
for section, cls in cfg._SECTIONS.items():
    toml_keys = set(toml.get(section, {}))
    code_keys = {f.name for f in fields(cls)}
    for key in sorted(code_keys | toml_keys):
        if f"`{section}.{key}`" not in doc:
            missing_doc.append(f"{section}.{key}")
        if key not in toml_keys:
            missing_toml.append(f"{section}.{key}")
    for key in sorted(toml_keys - code_keys):
        missing_toml.append(f"{section}.{key} (in TOML, unknown to the server)")

ok = True
if missing_doc:
    ok = False
    print("config fields missing from agent-kit/docs/CONFIGURATION.md:")
    print("\n".join(f"  {k}" for k in missing_doc))
if missing_toml:
    ok = False
    print("config fields out of sync between config/apparatus.toml and server/apparatus_server/config.py:")
    print("\n".join(f"  {k}" for k in missing_toml))
if ok:
    print("config documented: ok")
sys.exit(0 if ok else 1)
