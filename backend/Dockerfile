FROM node:24-bookworm-slim AS frontend-build

WORKDIR /workspace/frontend
ENV NEXT_TELEMETRY_DISABLED=1
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY backend/app/initial_board.json /workspace/backend/app/initial_board.json
RUN npm run build

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS base

WORKDIR /app
ENV UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY backend/app ./app
COPY --from=frontend-build /workspace/frontend/out ./app/static

FROM base AS test
RUN uv sync --locked --no-install-project
COPY backend/tests ./tests
RUN uv run --locked --no-sync python -m pytest -q

FROM base AS runtime
RUN useradd --system --uid 10001 --no-create-home app && mkdir /data && chown app:app /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD ["/app/.venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)"]
# Start as root only to fix ownership of a volume created by an earlier root-run image, then drop privileges.
CMD ["sh", "-c", "chown -R app:app /data && exec setpriv --reuid=app --regid=app --clear-groups /app/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000"]
