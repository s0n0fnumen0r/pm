# Kanban Studio

## Run

Install Docker with the Compose plugin and start Docker Desktop or the Docker daemon. From the project root:

- Windows (PowerShell): `.\scripts\start.ps1` and `.\scripts\stop.ps1`
- macOS/Linux: `sh scripts/start.sh` and `sh scripts/stop.sh`

Open http://127.0.0.1:8765 and sign in with `user` / `password`. Board changes are saved in the current browser tab, surviving refresh and sign-out. This temporary storage is not a shared or durable database and is cleared when the tab's session ends.

This fixed-credential login is for local development only, not production. Sessions expire after eight hours or a server restart. The server accepts requests for `127.0.0.1` and `localhost` only.

The Compose-managed `board-data` volume is mounted at `/data` for the future SQLite database. Stopping or restarting the app retains it. No database is created yet. The root `.env` is not included in the Docker build or passed to the container at this stage.

## Backend tests

Run `docker build --target test -f backend/Dockerfile .` from the project root. See `frontend/README.md` for frontend tests.
