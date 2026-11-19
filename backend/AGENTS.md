# Backend

Follow the project-level `AGENTS.md` and `docs/PLAN.md`.

- `app/main.py` defines the FastAPI app, initializes SQLite at startup, restricts hosts to loopback names, registers the authentication and board routers and example `/api/hello` route, and mounts static files at `/`. Register API routes before the static mount.
- `app/auth.py` implements the fixed local login, eight-hour in-memory sessions, an HTTP-only SameSite Strict cookie, logout, and same-origin checks for state-changing auth requests. Sessions are cleared when the server restarts. This is not production authentication.
- `app/database.py` initializes the versioned SQLite schema and provides connections with foreign keys enabled and explicit transactions. Compose sets `DATA_DIR=/data`, so the database is `/data/kanban.sqlite3`.
- `app/board.py` exposes authenticated `GET /api/board` and same-origin authenticated `PUT /api/board`, validates fixed columns and card consistency, seeds one board per user, and applies revision-checked updates atomically. See `docs/database-approach.md` for the API contract.
- `app/ai.py` exposes an authenticated, same-origin `POST /api/ai/check` connectivity check. It sends a fixed arithmetic prompt to the configured OpenRouter model using the server-side `OPENROUTER_API_KEY`; provider, network, configuration, and model errors are returned without logging or exposing the key.
- `app/initial_board.json` is the shared initial board for the backend and frontend. A frontend test checks it against the approved schema document.
- The Docker build copies the Next.js static export to `app/static/` in the image; that directory is not maintained as backend source.
- `pyproject.toml` and `uv.lock` define Python dependencies; the Docker image uses `uv` to install them.
- `tests/test_main.py` tests the exported page and JavaScript asset, the API, and a missing API route. `tests/test_auth.py` covers sessions, credentials, logout, expiration, and request-origin/host restrictions. `tests/test_board.py` exercises board operations, validation, user isolation, concurrent conflicts, rollback, and initialization. `tests/test_ai.py` mocks OpenRouter responses and checks authentication, configuration, network, provider, and model failures. The Dockerfile's `test` stage builds the frontend and runs the backend tests.
- Compose mounts the persistent `board-data` volume at `/data`; the frontend uses the authenticated board API and offers optional import of previous tab data.
