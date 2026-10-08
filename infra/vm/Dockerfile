# A user-VM stand-in for local development: Xvfb desktop, Chromium, agentd.
# Build from the repo root:  docker build -f infra/vm/Dockerfile -t apparatus-vm .
# In production the same pieces go on a Compute Engine image (infra/vm/setup.sh).
FROM python:3.11-slim
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb xdotool imagemagick x11-utils xfce4-session xfwm4 xfce4-panel ffmpeg \
      chromium fonts-dejavu-core curl ca-certificates iptables sudo \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --shell /bin/bash agent
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /opt/apparatus
COPY pyproject.toml uv.lock* ./
COPY packages/protocol/ packages/protocol/
COPY apps/agentd/ apps/agentd/
# The server is a workspace member; a stub package lets the workspace resolve without its code.
COPY apps/server/pyproject.toml apps/server/pyproject.toml
RUN mkdir -p apps/server/apparatus_server && touch apps/server/apparatus_server/__init__.py \
    && uv sync --frozen --no-dev --quiet 2>/dev/null || uv sync --no-dev --quiet
COPY infra/vm/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENV DISPLAY=:0 AGENTD_HOME=/home/agent AGENTD_DESKTOP=xdo AGENTD_KERNEL_USER=agent \
    AGENTD_STREAM_FPS=12 AGENTD_STREAM_WIDTH=1280 AGENTD_STREAM_HEIGHT=800 \
    AGENTD_SERVER_URL=ws://host.docker.internal:8080/ws/agentd AGENTD_VM_ID=local AGENTD_USER_ID=dev
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
