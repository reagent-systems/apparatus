# Session server image for Cloud Run (or any container host).
# Build from the repo root:  docker build -f apps/server/Dockerfile -t apparatus-server .
FROM node:22-slim AS web
WORKDIR /src
# The npm workspace: the root manifest and lock, then only what apps/web needs.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/design/package.json packages/design/
COPY packages/orb/package.json packages/orb/
RUN npm ci --silent --workspace apparatus-web
COPY apps/web/ apps/web/
COPY packages/design/ packages/design/
COPY packages/orb/ packages/orb/
RUN npm run build --workspace apparatus-web

FROM python:3.11-slim AS runtime
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 UV_SYSTEM_PYTHON=1
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock* ./
# The uv workspace resolves only with every member present.
COPY packages/protocol/ packages/protocol/
COPY apps/server/ apps/server/
COPY apps/agentd/ apps/agentd/
RUN uv sync --frozen --no-dev --quiet 2>/dev/null || uv sync --no-dev --quiet
COPY config/ config/
COPY --from=web /src/apps/web/dist apps/web/dist
ENV APPARATUS_HOST=0.0.0.0 APPARATUS_PORT=8080 APPARATUS_WEB_DIST=/app/apps/web/dist APPARATUS_CONFIG=/app/config/apparatus.toml
EXPOSE 8080
# The key arrives as an environment variable from Secret Manager. Nothing is baked in.
CMD ["uv", "run", "--no-sync", "apparatus-server"]
