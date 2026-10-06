#!/usr/bin/env bash
# Create the VM for one user from the launch template. Idempotent.
# Usage: AWS_REGION=... ./provision-vm.sh <user_id>
# The Name tag must match apparatus_server.vm.instance_name(user_id).
set -euo pipefail
: "${AWS_REGION:?}"
USER_ID="${1:?user_id}"
NAME="$(python3 - "$USER_ID" <<'PY'
import hashlib, re, sys
u = sys.argv[1]
slug = re.sub(r"[^a-z0-9-]", "-", u.lower()).strip("-")[:40]
d = hashlib.sha256(u.encode()).hexdigest()[:8]
print(f"apparatus-{slug}-{d}" if slug else f"apparatus-{d}")
PY
)"
FOUND="$(aws ec2 describe-instances --region "$AWS_REGION" \
  --filters "Name=tag:Name,Values=$NAME" \
  "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId' --output text)"
if [ -n "$FOUND" ]; then
  echo "exists: $NAME"
  exit 0
fi
AMI="$(aws ec2 describe-launch-template-versions --region "$AWS_REGION" \
  --launch-template-name apparatus-vm --versions '$Latest' \
  --query 'LaunchTemplateVersions[0].LaunchTemplateData.ImageId' --output text)"
if [ -z "$AMI" ] || [ "$AMI" = "None" ]; then
  echo "launch template apparatus-vm has no image. Run deploy/aws/build-vm-image.sh first." >&2
  exit 1
fi
python3 - "$USER_ID" "$NAME" <<'PY' > /tmp/apparatus-run.json
import json, sys
user, name = sys.argv[1], sys.argv[2]
json.dump({
    "LaunchTemplate": {"LaunchTemplateName": "apparatus-vm", "Version": "$Latest"},
    "MinCount": 1,
    "MaxCount": 1,
    "TagSpecifications": [
        {
            "ResourceType": "instance",
            "Tags": [
                {"Key": "Name", "Value": name},
                {"Key": "user_id", "Value": user},
                {"Key": "apparatus", "Value": "vm"},
            ],
        },
        {
            "ResourceType": "volume",
            "Tags": [
                {"Key": "Name", "Value": name},
                {"Key": "apparatus", "Value": "vm"},
            ],
        },
    ],
}, sys.stdout)
PY
ID="$(aws ec2 run-instances --region "$AWS_REGION" --cli-input-json file:///tmp/apparatus-run.json \
  --query 'Instances[0].InstanceId' --output text)"
echo "created: $NAME ($ID)"
