"""Every workflow under .github/workflows is valid YAML with jobs and a timeout on each job."""

import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    print("!! SKIPPED: pyyaml not installed")
    sys.exit(0)

root = Path(__file__).resolve().parents[2]
bad = []
for p in sorted((root / ".github/workflows").glob("*.yml")):
    try:
        doc = yaml.safe_load(p.read_text())
    except yaml.YAMLError as e:
        bad.append(f"{p.name}: {e}")
        continue
    if not isinstance(doc, dict) or "jobs" not in doc:
        bad.append(f"{p.name}: no jobs")
        continue
    for name, job in doc["jobs"].items():
        if "uses" in job:
            continue  # a reusable workflow call
        if "timeout-minutes" not in job:
            bad.append(f"{p.name}: job {name} has no timeout-minutes")
if bad:
    print("\n".join(bad))
    sys.exit(1)
print(f"workflows parse: ok ({len(list((root / '.github/workflows').glob('*.yml')))} files)")
