#!/usr/bin/env bash
# Boot script for a user VM. Reads instance metadata and writes the agentd env file.
# Runs as root at every boot. Compute Engine passes this file as the startup-script metadata.
# On EC2, user-data writes /etc/apparatus/deploy.env and the enroll secret, then calls this file.
set -euo pipefail

install -d -m 0750 -o root -g agentd /etc/apparatus

if curl -sf -m 2 -H 'Metadata-Flavor: Google' \
  "http://169.254.169.254/computeMetadata/v1/instance/id" >/dev/null; then
  md() { curl -sf -H 'Metadata-Flavor: Google' "http://169.254.169.254/computeMetadata/v1/instance/attributes/$1"; }
  cat > /etc/apparatus/agentd.env <<ENV
AGENTD_SERVER_URL=$(md server_url)
AGENTD_VM_ID=$(md vm_id)
AGENTD_USER_ID=$(md user_id)
AGENTD_LOG_LEVEL=INFO
ENV
  # The enrollment secret is a per-deployment value, not a per-user one. It proves "this is a VM
  # of this deployment"; the server still pins the VM to its user_id.
  md enroll_secret > /etc/apparatus/enroll.secret
  chown root:agentd /etc/apparatus/enroll.secret /etc/apparatus/agentd.env
  chmod 0640 /etc/apparatus/enroll.secret /etc/apparatus/agentd.env
  systemctl restart agentd
  exit 0
fi

if ! TOKEN=$(curl -sf -m 2 -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600"); then
  echo "no instance metadata; agentd env unchanged" >&2
  exit 0
fi

aws_tag() {
  curl -sf -m 2 -H "X-aws-ec2-metadata-token: $TOKEN" \
    "http://169.254.169.254/latest/meta-data/tags/instance/$1" || true
}

USER_ID=""
VM_ID=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  USER_ID="$(aws_tag user_id)"
  VM_ID="$(aws_tag Name)"
  if [ -n "$USER_ID" ] && [ -n "$VM_ID" ]; then
    break
  fi
  sleep 2
done
if [ -z "$USER_ID" ] || [ -z "$VM_ID" ]; then
  echo "instance tags user_id and Name are missing" >&2
  exit 1
fi
if [ ! -f /etc/apparatus/deploy.env ]; then
  echo "missing /etc/apparatus/deploy.env" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. /etc/apparatus/deploy.env
set +a
if [ -z "${AGENTD_SERVER_URL:-}" ]; then
  echo "AGENTD_SERVER_URL is empty" >&2
  exit 1
fi
{
  printf 'AGENTD_SERVER_URL=%s\n' "$AGENTD_SERVER_URL"
  printf 'AGENTD_VM_ID=%s\n' "$VM_ID"
  printf 'AGENTD_USER_ID=%s\n' "$USER_ID"
  printf 'AGENTD_LOG_LEVEL=INFO\n'
} > /etc/apparatus/agentd.env
chown root:agentd /etc/apparatus/agentd.env
chmod 0640 /etc/apparatus/agentd.env
if [ ! -s /etc/apparatus/enroll.secret ]; then
  echo "missing /etc/apparatus/enroll.secret" >&2
  exit 1
fi
chown root:agentd /etc/apparatus/enroll.secret
chmod 0640 /etc/apparatus/enroll.secret
systemctl restart agentd
