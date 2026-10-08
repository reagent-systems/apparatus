#!/usr/bin/env bash
# Create the VM for one user from the instance template. Idempotent.
# Usage: GCP_PROJECT=... GCP_ZONE=... ./provision-vm.sh <user_id>
# The instance name must match apparatus_server.vm.instance_name(user_id).
set -euo pipefail
USER_ID="${1:?user_id}"
NAME="$(python3 - "$USER_ID" <<'PY'
import hashlib, re, sys
u = sys.argv[1]
slug = re.sub(r"[^a-z0-9-]", "-", u.lower()).strip("-")[:40]
d = hashlib.sha256(u.encode()).hexdigest()[:8]
print(f"apparatus-{slug}-{d}" if slug else f"apparatus-{d}")
PY
)"
if gcloud compute instances describe "$NAME" --project "$GCP_PROJECT" --zone "$GCP_ZONE" >/dev/null 2>&1; then
  echo "exists: $NAME"; exit 0
fi
TEMPLATE="$(gcloud compute instance-templates list --project "$GCP_PROJECT" --filter='name~^apparatus-vm-' --sort-by=~creationTimestamp --format='value(name)' --limit 1)"
gcloud compute instances create "$NAME" \
  --project "$GCP_PROJECT" --zone "$GCP_ZONE" \
  --source-instance-template "$TEMPLATE" \
  --metadata "vm_id=$NAME,user_id=$USER_ID" \
  --labels "apparatus-user=$(echo "$USER_ID" | tr -c 'a-z0-9-\n' '-' | cut -c1-60)"
# The VM boots, agentd connects, then the server's idle stop turns it off until the first session.
echo "created: $NAME"
