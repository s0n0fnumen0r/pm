# Kanban Studio

## Run

Install Docker with the Compose plugin and start Docker Desktop or the Docker daemon. From the project root:

- Windows (PowerShell): `.\scripts\start.ps1` and `.\scripts\stop.ps1`
- macOS/Linux: `sh scripts/start.sh` and `sh scripts/stop.sh`

Open http://127.0.0.1:8765 and sign in with `user` / `password`. Board changes save automatically; the board reports pending saves, failures, and conflicts. Save or cancel an open card edit before signing out.

This fixed-credential login is for local development only, not production. Sessions expire after eight hours or a server restart. The server accepts requests for `127.0.0.1` and `localhost` only.

The authenticated board API stores its data in `/data/kanban.sqlite3` on the Compose-managed `board-data` volume; stopping or restarting the app retains it. If this tab has an older tab-only board, you can import it when the database board is still untouched. The old tab data is not deleted. See [the database approach](docs/database-approach.md) for the API and conflict handling.

## AI connectivity

Create a root `.env` file next to `compose.yaml` containing `OPENROUTER_API_KEY=your-key`. Compose passes this variable only to the backend container; do not commit `.env` or put the key in frontend configuration. The configured model is `nvidia/nemotron-3.5-super-vl:free`. After starting the app and signing in, the chat sidebar sends the current board, conversation history, and your message to OpenRouter; those requests are processed outside your machine. The conversation remains in the current page session and is not saved. An authenticated same-origin `POST /api/ai/check` can also send a fixed `2 + 2` prompt to verify connectivity. The API key remains server-side and is not returned to the browser or written to application logs.

## Backend tests

Run `docker build --target test -f backend/Dockerfile .` from the project root. See `frontend/README.md` for frontend tests.
