# Session server image for Cloud Run (or any container host).
# Build from the repo root:  docker build -f server/Dockerfile -t apparatus-server .
FROM node:22-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci --silent || npm install --silent
COPY web/ ./
RUN npm run build

FROM python:3.11-slim AS runtime
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 UV_SYSTEM_PYTHON=1
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock* ./
COPY protocol/ protocol/
COPY server/ server/
COPY agentd/ agentd/
RUN uv sync --frozen --no-dev --quiet 2>/dev/null || uv sync --no-dev --quiet
COPY config/ config/
COPY --from=web /src/web/dist web/dist
ENV APPARATUS_HOST=0.0.0.0 APPARATUS_PORT=8080 APPARATUS_WEB_DIST=/app/web/dist APPARATUS_CONFIG=/app/config/apparatus.toml
EXPOSE 8080
# The key arrives as an environment variable from Secret Manager. Nothing is baked in.
CMD ["uv", "run", "--no-sync", "apparatus-server"]
