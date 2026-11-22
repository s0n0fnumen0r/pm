# Code Review: Kanban Studio

Date: 2026-11-19. Scope: the whole repository at commit `adfbfa8`. Method: I read the code, the lockfile and the git history; I did not run the test suites.

## 1. What the project does

Kanban Studio is a single-user project-management app that runs locally. It has a Kanban board and an AI chat assistant. Docker packages it as one container: FastAPI serves both the JSON API and a statically exported Next.js frontend.

### Runtime layout

- [compose.yaml](../compose.yaml) builds one `app` service and publishes it only on `127.0.0.1:8765`. It passes `OPENROUTER_API_KEY` from the root `.env` and keeps the SQLite file on the `board-data` volume at `/data`.
- [backend/Dockerfile](../backend/Dockerfile) is a multi-stage build:
  1. Node 24 builds the frontend with `next build` and `output: "export"`.
  2. A `uv` Python 3.13 image installs the locked dependencies.
  3. The `test` target runs pytest during the build.
  4. The `runtime` target runs uvicorn on port 8000.
- [scripts/](../scripts/) has start and stop wrappers for PowerShell and POSIX shells around `docker compose up --build -d` / `down`.

### Backend (FastAPI)

| Module | What it does |
|---|---|
| [main.py](../backend/app/main.py) | Creates the database schema at startup, adds `TrustedHostMiddleware` (only `localhost` and `127.0.0.1` are accepted, which blocks DNS rebinding), mounts the routers, and serves the static frontend at `/`. |
| [auth.py](../backend/app/auth.py) | Hardcoded login `user`/`password`. Sessions live in memory (`token -> (username, expiry)`) with an 8-hour TTL, behind an `HttpOnly`, `SameSite=Strict` cookie. A new token is issued at each login and the old one is dropped. `require_same_origin` checks the `Origin` header on state-changing routes as CSRF protection. Endpoints: `/api/login`, `/api/session`, `/api/logout`. |
| [database.py](../backend/app/database.py) | SQLite with `STRICT` tables: `users`, `boards` (with `revision`), `board_columns`, `cards`. Foreign keys cascade on delete. `PRAGMA user_version` tracks the schema version. Writes use `BEGIN IMMEDIATE` transactions. |
| [board.py](../backend/app/board.py) | `GET /api/board` creates the user and board on first access, seeded from [initial_board.json](../backend/app/initial_board.json). `PUT /api/board` replaces the whole board under optimistic concurrency: the client sends `revision`, a stale revision gets 409, and a successful save increments it. Pydantic checks that the 5 fixed columns are in order, card IDs match their keys, no title is blank, and each card appears in exactly one column. |
| [ai.py](../backend/app/ai.py) | `POST /api/ai/check` runs a "2+2" connectivity test. `POST /api/ai/chat` sends a system prompt, the client's chat history, and the current board plus the request to OpenRouter (`nvidia/nemotron-3.5-super-vl:free`) with strict JSON-schema Structured Outputs. If the model returns a `board_update`, it is validated and saved with `replace_board` against the revision read before the LLM call, so a board edited in the meantime gets 409 instead of being overwritten. Provider errors are turned into clear 502/503 messages. |

### Frontend (Next.js 16 / React 19, client-only)

- [AuthGate.tsx](../frontend/src/components/AuthGate.tsx) checks the session, then shows either the login form or the board, and handles sign-out.
- [useBoard.ts](../frontend/src/lib/useBoard.ts) owns board state and autosave:
  - Every change bumps a local sequence number.
  - `flush()` sends the latest snapshot with `PUT`, one request at a time, so edits made during a save are merged into the next one.
  - Status values: saving, saved, error, conflict, expired, reloading.
  - It warns before the page unloads, and it offers a one-time import of a board left in `sessionStorage` by the older frontend-only version.
- [KanbanBoard.tsx](../frontend/src/components/KanbanBoard.tsx):
  - dnd-kit drag and drop, with the move logic in [kanban.ts `moveCard`](../frontend/src/lib/kanban.ts#L32).
  - Rename columns, add, edit and delete cards.
  - Error, conflict and expired-session panels, including signing in again inline.
  - Editing is locked while a chat request or reload is running.
- [AIChatSidebar.tsx](../frontend/src/components/AIChatSidebar.tsx) keeps the chat in component state only. It validates the response shape, applies the board the server returns, and handles 401/409 cleanly. It is disabled unless the board is fully saved and no card edit is open.

### Tests

- Backend: 27 pytest tests (auth, board, AI with the provider mocked, main), run inside `docker build --target test`.
- Frontend: Vitest unit and component tests (26) and Playwright end-to-end tests (18 across auth, kanban, migration and persistence).

Overall the codebase is in good shape: small, consistent, careful about concurrency, and well tested for an MVP. The items below are ranked by importance.

---

## 2. Findings and recommendations

### High

**H1. Check where the `httpx2` test dependency comes from.** [pyproject.toml](../backend/pyproject.toml) lists `httpx2` (plus `httpcore2` and `httpx2-jsfetch`) instead of the usual `httpx`, which is what `fastapi.testclient` normally relies on. It was added in commit `54f8822`, and the locked release was uploaded on 2026-11-16, three days before this review. The lookalike name and the very recent release are typical signs of typosquatting. This review can't confirm that it's malicious, but it runs inside the Docker build.

- Check it on PyPI (maintainer, repository, download history).
- Unless it was chosen deliberately, replace it with `httpx` and run `uv lock` again.

The same caution applies to the new `opentelemetry-api` dependency pulled in by `fastapi 0.165.0` (released 2026-11-18). It is probably legitimate, but it's worth a look.

**H2. The AI can delete or rewrite the whole board.** The chat contract asks the model for the *complete* board ([ai.py:272-279](../backend/app/ai.py#L272-L279)), and `replace_board` deletes any card the model leaves out ([board.py:143-144](../backend/app/board.py#L143-L144)). That causes two problems:

- **Model mistakes:** a free model that drops cards silently deletes data.
- **Prompt injection:** card text and chat history are controlled by the client or user, and the prompt telling the model to treat them as untrusted is only a soft defence.

The requirement only asks for create, edit and move. Options:

- Switch the schema to a list of operations (`create`, `update`, `move`) so deletion isn't possible.
- Or keep full-board output but reject or confirm any update that removes cards.
- Or show a diff and apply only after the user confirms.

The `revision` column ([database.py:17](../backend/app/database.py#L17)) would also make undo cheap: keep the previous snapshot and add an "Undo AI change" button.

**H3. No size limits on board content.** `Card.title`, `Card.details`, `Column.title` and the number of cards have no maximum ([board.py:22-36](../backend/app/board.py#L22-L36)). A large `PUT` grows the database without limit, and the whole board goes into every LLM prompt, which adds token cost and can overflow the context. Fix:

- Add `Field(max_length=...)` to the text fields and a cap on the number of cards.
- Match them with `maxLength` on the frontend inputs.
- Consider `--limit-concurrency` or a request-size limit in uvicorn.

### Medium

**M1. Column titles can be blank.** Card titles must not be blank, but column titles have no check ([board.py:28-31](../backend/app/board.py#L28-L31)). The column `<input>` lets the user clear the title, and the empty value is saved. Add a non-blank check, or fall back to the previous title when the input loses focus.

**M2. Renaming a column sends a request per keystroke.** [KanbanColumn.tsx:48](../frontend/src/components/KanbanColumn.tsx#L48) calls `onRename` on every `onChange`, and each call triggers a full-board `PUT`. `flush` merges changes made while a save is in flight, so this is correct, but it is noisy and bumps `revision` many times. Fix: commit the title on blur or Enter (with a local draft state), or debounce `flush`.

**M3. Drag and drop is not keyboard accessible.** Only `PointerSensor` is registered ([KanbanBoard.tsx:55-59](../frontend/src/components/KanbanBoard.tsx#L55-L59)), so keyboard and screen-reader users can't move cards. Add `useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })`.

**M4. Credential comparison and brute force.** [auth.py:43](../backend/app/auth.py#L43) compares credentials with `!=`, which isn't constant-time, and there's no rate limiting on login. This is fine for a fixed local dev login, but before adding real users:

- Store password hashes (argon2 or bcrypt) in the existing `users` table.
- Compare with `secrets.compare_digest`.
- Throttle failed attempts.

**M5. Sessions live in process memory.** Restarting the server signs everyone out (the README says so), and running more than one uvicorn worker would break authentication. Moving to multiple users would mean storing sessions in SQLite (a `sessions` table with a hashed token and expiry).

**M6. The container runs as root.** The [Dockerfile](../backend/Dockerfile) has no `USER` line. Add a non-root user and `chown /data`. A `HEALTHCHECK` against `/api/hello`, or a dedicated `/api/health`, would also help.

**M7. Every `GET /api/board` takes a write lock.** `get_board` and `_get_board` always open a `BEGIN IMMEDIATE` transaction ([board.py:113](../backend/app/board.py#L113), [ai.py:247](../backend/app/ai.py#L247)), because the board might need creating. That serialises all reads. Fix: try a read transaction first and fall back to the write path only when the user or board is missing. Enabling `PRAGMA journal_mode=WAL` once at startup would also help.

### Low and cleanup

- **L1. The cookie has no `secure` flag** ([auth.py:56](../backend/app/auth.py#L56)). That's correct for plain HTTP on localhost. If the app is ever served over HTTPS, set `secure=True`, or `__Host-` prefix the cookie.
- **L2. No security headers.** Add `Content-Security-Policy` (at least `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, and `Referrer-Policy` with a small middleware. Cheap insurance against clickjacking and injection.
- **L3. Logging out with an expired session leaves the cookie.** `logout` depends on `require_user` ([auth.py:72](../backend/app/auth.py#L72)), so an expired session returns 401 and the stale cookie is never deleted. Logout could skip `require_user` and always clear the cookie.
- **L4. The client controls the chat history.** The client can make up `assistant` turns. The impact is limited because it's the user's own board, but it makes injection easier (see H2). Option: keep the history on the server, keyed by session.
- **L5. Board reads depend on the current seed file.** If `initial_board.json` column IDs ever change, `read_board` builds a `Board` that fails validation, and existing users get a 500 ([board.py:107](../backend/app/board.py#L107)). Any change to the fixed columns needs a migration (bump `SCHEMA_VERSION`).
- **L6. Placeholder text is saved as data.** `details || "No details yet."` ([KanbanBoard.tsx:94](../frontend/src/components/KanbanBoard.tsx#L94)) stores the placeholder. Store `""` and show the placeholder at render time instead.
- **L7. Removing a card has no confirmation or undo** ([KanbanCard.tsx:113-120](../frontend/src/components/KanbanCard.tsx#L113-L120)).
- **L8. Stale `status` in `updateBoard`.** `updateBoard` reads `status` from the render it was created in ([useBoard.ts:129](../frontend/src/lib/useBoard.ts#L129)). A `useRef` mirror would be more robust. The `<fieldset disabled>` covers this in practice.
- **L9. Dead code:**
  - The `/api/hello` scaffold endpoint ([main.py:28](../backend/app/main.py#L28)).
  - A redundant `isinstance(answer, str)` check ([ai.py:225](../backend/app/ai.py#L225)).
  - `StrictModel` is defined twice (`ai.py` and `board.py`); import it from one place.
- **L10. The frontend imports a backend file.** It reads `../../../backend/app/initial_board.json` ([kanban.ts:1](../frontend/src/lib/kanban.ts#L1)), and the Dockerfile copies that file in specially. It works, but it's fragile. A small shared `contracts/` folder would make the dependency explicit.
- **L11. Free-tier data handling.** OpenRouter's free models may log or train on prompts. The UI does say data is sent to OpenRouter. If boards may contain sensitive content, consider a paid model with a no-retention policy.
- **L12. The 20-second LLM call blocks a worker thread** ([ai.py:183](../backend/app/ai.py#L183)). It's a sync endpoint, so it runs in a threadpool, which is fine at this scale. An async `httpx` client would scale better.

### Already handled well (no action needed)

- `.env` is gitignored, has never been committed, and is excluded from the Docker build context.
- The API key stays on the server and provider errors are cleaned up before reaching the client.
- Defence against CSRF and DNS rebinding: SameSite=Strict, an Origin check, and TrustedHost.
- Optimistic concurrency covers both manual edits and AI edits.
- All SQL is parameterised. The one f-string sets `user_version` from a constant.
- `replace_board` reorders cards without breaking the `UNIQUE (board_id, column_id, position)` constraint, by shifting all positions out of range before rewriting them.
- Strict Pydantic models (`extra="forbid"`) and runtime validation of server responses on the frontend.

---

## 3. Suggested order of work

1. **H1:** confirm or replace `httpx2`.
2. **H2:** limit what the AI can change (operation-based schema, or confirmation plus undo).
3. **H3 and M1:** add length, count and blank-title validation.
4. **M2 and M3:** commit column titles on blur and add `KeyboardSensor`.
5. **M6 and L2:** run the container as non-root, add a healthcheck and security headers.
6. **M4 and M5:** hashed passwords and SQLite sessions, when multi-user work starts.

---

## 4. Implementation log

Date: 2026-11-21. Verified with `docker build --target test` (66 backend tests pass, including the frontend build), `npm run lint`, `tsc --noEmit` and Vitest (29 tests pass). A smoke test of the runtime image confirmed it runs as UID 10001, reports `healthy`, sends the new headers, and starts correctly on a volume that holds root-owned files. The Playwright end-to-end specs were updated but not run, because they reset the board and need an isolated container (see `frontend/README.md`).

### High

| Item | Result |
|---|---|
| H1 | **No change needed.** `httpx2` is not a typosquat. PyPI lists Tom Christie as the author, with the source at [pydantic/httpx2](https://github.com/pydantic/httpx2) (about 1,600 stars, 25 releases). `starlette 1.10.0` lists `httpx2` in its `full` extra, and `fastapi 0.165.0` lists it in `standard`. `opentelemetry-api` is published by the OpenTelemetry project (`open-telemetry/opentelemetry-python`), and `fastapi 0.165.0` requires it. Both stay in `uv.lock`. |
| H2 | **Done, using the operation-based option.** The chat contract in `ai.py` is now `{response, operations[]}`. Each operation is `create`, `update` or `move`, so the model has no way to delete a card or touch columns. The server applies the operations to the current board, validates the result with the `Board` model, and saves it with the revision check as before. The server assigns IDs to new cards, at most 25 operations are accepted per reply, and any unknown card or column, empty update or invalid result gives 502 with nothing saved. The system prompt now says deletion is unsupported. The response sent to the frontend is unchanged. The undo button was not added. |
| H3 | **Done.** Limits live in `board.py`: card title 200, card details 5000, column title 100, ID 64 characters, 500 cards. The frontend has matching `maxLength` attributes and disables "Add a card" at 500 cards (constants in `kanban.ts`). A body-size middleware in `main.py` returns 413 for bodies over 4 MiB, whether declared by `Content-Length` or streamed in chunks. `--limit-concurrency` was not added. |

### Medium

| Item | Result |
|---|---|
| M1 | **Done.** `Board` rejects blank column titles. Boards saved earlier with a blank column title fall back to that column's default title when read. The frontend reverts a blank title (see M2). |
| M2 | **Done.** `KanbanColumn` keeps a local draft and commits it on blur or Enter. Escape or a blank value reverts, and the draft resets if the title changes from outside. A rename now causes one request and one revision bump. |
| M3 | **Done.** `KeyboardSensor` with `sortableKeyboardCoordinates` is registered in `KanbanBoard`. |
| M4 | **Not done, deferred.** It only matters once real users are added. |
| M5 | **Not done, deferred**, for the same reason. |
| M6 | **Done.** The runtime stage creates an `app` user (UID 10001) and a `/data` directory it owns, and adds a `HEALTHCHECK` against the new `/api/health` route. The container starts as root only to `chown -R /data`, so an existing volume created by the old root-run image keeps working, and then drops privileges with `setpriv` before starting uvicorn. |
| M7 | **Done.** `GET /api/board` and the chat route use `load_board`, which reads in a normal transaction and only takes `BEGIN IMMEDIATE` when the user or board is missing. `initialize_database` also sets `PRAGMA journal_mode = WAL`. |

### Low and cleanup

| Item | Result |
|---|---|
| L1 | Not done. It stays correct for plain HTTP on localhost. |
| L2 | **Done.** A middleware adds `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: same-origin`. There is no full `script-src` policy, because the Next.js static export uses inline scripts. |
| L3 | **Done.** `logout` no longer depends on `require_user`, so it always clears the cookie. Signing out with an expired session now returns to the sign-in form without the "session expired" message, and the Playwright test was updated to match. The unused 401 branch in `AuthGate` was removed. |
| L4 | Not done. Server-side chat history would be a larger change. |
| L5 | Not done. No fixed columns were changed. |
| L6 | **Done.** New cards store `""` as details, and `KanbanCard` and `KanbanCardPreview` show "No details yet." when details are empty. Cards that already contain the saved placeholder text keep it. |
| L7 | Not done. |
| L8 | Not done. |
| L9 | **Done.** The `/api/hello` scaffold is replaced by `/api/health`, and the tests that used it were updated. The redundant `isinstance` check in `check_openrouter` is gone. `ai.py` imports `StrictModel` from `board.py`. |
| L10 | Not done. |
| L11 | Not done. |
| L12 | Not done. |

### Tests and docs changed

- **Backend tests:** `test_ai.py` covers the operation flow, the schema's lack of delete, 13 kinds of invalid operation, and rejection of the old full-board format. `test_board.py` covers the size limits and blank column titles, plus the fallback for old data. `test_main.py` covers `/api/health`, the headers and 413 responses. `test_auth.py` covers logout with an expired session.
- **Frontend tests:** `KanbanBoard.test.tsx` now commits column renames on blur, and adds tests for commit on Enter, revert on blank or Escape, `maxLength` and the details placeholder. The Playwright specs press Enter after renaming a column and use `/api/health`.
- **Docs:** `README.md`, `backend/AGENTS.md` and `frontend/AGENTS.md` describe the new behaviour.

### Notes for later

- Existing rows that break the new limits (a title over 200 characters, for example) would fail validation when the board is read. Nothing was unbounded before, so a database that already holds such a row would need it trimmed by hand. The same applies to any future change to these limits.
- `docs/database-approach.md` still describes the earlier validation rules and was not changed.