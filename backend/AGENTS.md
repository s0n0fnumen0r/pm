# Backend

Follow the project-level `AGENTS.md` and `docs/PLAN.md`.

- `app/main.py` defines the FastAPI app, restricts hosts to loopback names, registers the authentication router and example `/api/hello` route, and mounts static files at `/`. Register API routes before the static mount.
- `app/auth.py` implements the fixed local login, eight-hour in-memory sessions, an HTTP-only SameSite Strict cookie, logout, and same-origin checks for state-changing auth requests. Sessions are cleared when the server restarts. This is not production authentication.
- Protect future board routes with `require_user`; require `require_same_origin` for state-changing routes. No board API exists yet.
- The Docker build copies the Next.js static export to `app/static/` in the image; that directory is not maintained as backend source.
- `pyproject.toml` and `uv.lock` define Python dependencies; the Docker image uses `uv` to install them.
- `tests/test_main.py` tests the exported page and JavaScript asset, the API, and a missing API route. `tests/test_auth.py` covers sessions, credentials, logout, expiration, and request-origin/host restrictions. The Dockerfile's `test` stage builds the frontend and runs these tests.
- Compose mounts the persistent `board-data` volume at `/data` and exposes its location as `DATA_DIR`; database initialization is planned for Part 6, after schema approval.
