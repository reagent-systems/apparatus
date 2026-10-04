#!/usr/bin/env bash
# Compute Engine startup script for a user VM. Reads instance metadata written by Terraform
# or the provisioning job, and writes the agentd env file. Runs as root at every boot.
set -euo pipefail
md() { curl -sf -H 'Metadata-Flavor: Google' "http://169.254.169.254/computeMetadata/v1/instance/attributes/$1"; }
install -d -m 0750 -o root -g agentd /etc/apparatus
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
