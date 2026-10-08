#!/usr/bin/env bash
# Start a virtual desktop, then agentd. Used by infra/vm/Dockerfile for local development.
set -euo pipefail
Xvfb :0 -screen 0 1280x800x24 -nolisten tcp &
sleep 0.5
if command -v xfce4-session >/dev/null; then
  (sudo -u agent -E DISPLAY=:0 HOME=/home/agent xfce4-session >/tmp/xfce.log 2>&1 &) || true
fi
# Block the metadata server for everyone but root. Harmless where no such server exists.
iptables -A OUTPUT -d 169.254.169.254 -m owner ! --uid-owner 0 -j REJECT 2>/dev/null || true
# agentd runs as root here so it can launch kernels as the agent user.
# The enrollment secret is read from a file only root can read (or empty in dev).
exec uv run --no-sync agentd
