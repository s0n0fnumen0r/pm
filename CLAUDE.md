# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Required reading

`AGENTS.md` (root) holds the authoritative project requirements, coding standards (keep it simple, no over-engineering, no emojis, prove root cause before fixing) and color scheme. Read `docs/PLAN.md` before starting work; it records decisions and per-part status. `backend/AGENTS.md`, `frontend/AGENTS.md` and `scripts/AGENTS.md` describe each area file by file; keep them accurate when you change those areas. `docs/database-approach.md` defines the board API contract and conflict handling.

## Commands

Full app (Docker, from the project root; serves http://127.0.0.1:8765, login `user` / `password`):
- Windows: `.\scripts\start.ps1` / `.\scripts\stop.ps1`
- macOS/Linux: `sh scripts/start.sh` / `sh scripts/stop.sh`

Backend tests (builds the frontend export, then runs pytest in the `test` stage):
- `docker build --target test -f backend/Dockerfile .`
- Locally from `backend/`: `uv run pytest tests/test_board.py::test_name`. `app/main.py` mounts `app/static` at import, so that directory must contain a frontend export (copy `frontend/out` after `npm run build`); it is not source and is not committed.

Frontend (from `frontend/`):
- `npm run lint`, `npm run build` (static export to `out/`)
- `npm run test:unit`; single file: `npx vitest run src/lib/kanban.test.ts`; single test: add `-t "name"`
- `npm run test:e2e` (Playwright) resets the board. Run only against an isolated container with a disposable volume: set `KANBAN_ISOLATED_TEST=1`, `PLAYWRIGHT_BASE_URL`, and `PLAYWRIGHT_BROWSER_CHANNEL=msedge` (or `chrome`). The restart test also needs `KANBAN_TEST_CONTAINER_ID` (container name prefixed `kanban-part7-test-`); `migration.spec.ts` needs `KANBAN_FRESH_TEST=1` on a fresh volume and must run first.
- `npm run dev` has no backend API, so sign-in does not work there; use Docker for the complete flow.

## Architecture

One container: `backend/Dockerfile` builds the Next.js static export (Node stage), copies it into `backend/app/static`, and FastAPI serves it at `/` after the `/api/*` routers. Register new API routes before the static mount in `app/main.py`. The host is restricted to `localhost`/`127.0.0.1`, request bodies are capped at 4 MiB, and SQLite lives at `$DATA_DIR/kanban.sqlite3` (`/data` on the `board-data` volume).

- Auth (`app/auth.py`): fixed credentials, in-memory 8-hour sessions in an HTTP-only SameSite Strict cookie. State-changing requests require a same-origin check. Sessions are lost on restart.
- Board (`app/board.py`): one board per user. `GET /api/board` returns the board and its revision; `PUT /api/board` replaces the whole board atomically with an expected revision and returns 409 on a mismatch. Five fixed column IDs (titles renameable); size limits are enforced here and mirrored in the frontend.
- AI (`app/ai.py`): `POST /api/ai/chat` sends the board and conversation to OpenRouter (`OPENROUTER_MODEL`, key from `OPENROUTER_API_KEY` in root `.env`) with required Structured Outputs. The model returns at most 25 `create`/`update`/`move` operations (no delete); the server applies them, assigns new card IDs, validates them with the board model and saves through the same revision-checked transaction. Tests mock OpenRouter.
- `backend/app/initial_board.json` is the seed board shared by the backend and frontend (`frontend/src/lib/kanban.ts` imports it; `next.config.ts` sets the Turbopack root to the repo root for this).
- Frontend: `AuthGate` -> `KanbanBoard` -> columns/cards plus `AIChatSidebar`. `src/lib/useBoard.ts` owns server state: it serializes revision-checked saves, surfaces pending/failed/conflict/session-expired states, keeps unsaved edits on errors, and accepts board+revision results from AI chat. Board data is `{ columns: [{id, title, cardIds}], cards: {id: card} }`; `moveCard` in `kanban.ts` handles drag-and-drop reordering (dnd-kit).
