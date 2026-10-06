#!/usr/bin/env bash
# Build the user-VM image on a fresh Debian 12 Compute Engine instance.
# Run once as root on the image-builder VM, then create an image from its disk:
#   gcloud compute images create apparatus-vm-$(date +%Y%m%d) --source-disk=<builder-disk> --family=apparatus-vm
# The design spec: light desktop, Chromium, Python, agentd as a daemon, one outbound connection,
# no inbound ports, metadata server blocked for the agent, VM identity with no permissions.
# The same image boots on Compute Engine and on EC2. vm/startup.sh reads whichever metadata service answers.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  xvfb xdotool imagemagick x11-utils xfce4 xfce4-terminal chromium fonts-dejavu-core ffmpeg \
  python3 python3-venv python3-pip git curl ca-certificates jq unzip iptables-persistent sudo

# Users: agentd runs as its own system user; task kernels run as "agent".
id -u agent >/dev/null 2>&1 || useradd --create-home --shell /bin/bash agent
id -u agentd >/dev/null 2>&1 || useradd --system --home /var/lib/agentd --create-home --shell /usr/sbin/nologin agentd

# agentd may start kernels as the agent user, nothing else.
cat > /etc/sudoers.d/agentd <<'SUDO'
agentd ALL=(agent) NOPASSWD: /usr/bin/env, /opt/apparatus/.venv/bin/python
SUDO
chmod 0440 /etc/sudoers.d/agentd

# Code. The deploy workflow copies the repo tarball to /opt/apparatus.
install -d -o agentd -g agentd /opt/apparatus
if [ -d /opt/apparatus/agentd ]; then
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
  (cd /opt/apparatus && sudo -u agentd uv sync --no-dev --quiet)
fi

# Disk layout owned by the agent user.
sudo -u agent mkdir -p /home/agent/memory/notes /home/agent/tools /home/agent/tasks /home/agent/sessions /home/agent/browser-profile

# The VM dials out and listens to nothing.
iptables -P INPUT DROP
iptables -A INPUT -i lo -j ACCEPT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# Metadata server: root only (the guest agent needs it). The agent and agentd never reach it.
iptables -A OUTPUT -d 169.254.169.254 -m owner ! --uid-owner 0 -j REJECT
netfilter-persistent save

# Virtual display + desktop + agentd as services.
cat > /etc/systemd/system/apparatus-display.service <<'UNIT'
[Unit]
Description=Apparatus virtual display
After=network.target
[Service]
ExecStart=/usr/bin/Xvfb :0 -screen 0 1280x800x24 -nolisten tcp
Restart=always
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/apparatus-desktop.service <<'UNIT'
[Unit]
Description=Apparatus desktop session for the agent user
After=apparatus-display.service
Requires=apparatus-display.service
[Service]
User=agent
Environment=DISPLAY=:0 HOME=/home/agent
ExecStart=/usr/bin/xfce4-session
Restart=always
[Install]
WantedBy=multi-user.target
UNIT

install -m 0644 /opt/apparatus/vm/agentd.service /etc/systemd/system/agentd.service 2>/dev/null || true
systemctl daemon-reload
systemctl enable apparatus-display apparatus-desktop agentd
echo "image setup done"
