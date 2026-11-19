# Kanban Studio

## Run

Install Docker with the Compose plugin and start Docker Desktop or the Docker daemon. From the project root:

- Windows (PowerShell): `.\scripts\start.ps1` and `.\scripts\stop.ps1`
- macOS/Linux: `sh scripts/start.sh` and `sh scripts/stop.sh`

Open http://127.0.0.1:8765 and sign in with `user` / `password`. The frontend still saves board changes only in the current browser tab, surviving refresh and sign-out but not the end of the tab's session. It is not yet connected to the database.

This fixed-credential login is for local development only, not production. Sessions expire after eight hours or a server restart. The server accepts requests for `127.0.0.1` and `localhost` only.

The authenticated board API stores its data in `/data/kanban.sqlite3` on the Compose-managed `board-data` volume; stopping or restarting the app retains it. See [the database approach](docs/database-approach.md) for the API, initialization, and conflict handling. The root `.env` is not included in the Docker build or passed to the container at this stage.

## Backend tests

Run `docker build --target test -f backend/Dockerfile .` from the project root. See `frontend/README.md` for frontend tests.
