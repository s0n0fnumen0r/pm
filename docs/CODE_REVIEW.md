# Code Review: Kanban Studio

Date: 2026-11-23. Scope: the whole repository at commit `521e754`. This replaces the review of 2026-11-19 (commit `adfbfa8`); section 4 tracks what happened to its findings.

Method: I read all backend and frontend source, the tests, Docker and Compose files, scripts and docs. I ran every test suite and audited the dependencies (section 1).

## 1. Verification performed

| Check | Result |
|---|---|
| Backend tests, `docker build --target test` | 66 passed |
| Frontend `npm run lint`, `tsc --noEmit` | Clean |
| Frontend Vitest | 29 passed |
| Playwright (Edge), isolated container and fresh volume | 20 passed: `migration.spec.ts` alone first, then 19 in the full run (the migration spec skips without `KANBAN_FRESH_TEST`), including the real container restart |
| `pip-audit` on the exported `uv.lock` | No known vulnerabilities |
| `npm audit` | 25 vulnerabilities: 4 critical, 14 high, 6 moderate, 1 low (see H1) |

No live OpenRouter request was made; all AI tests use mocked responses.

## 2. Architecture summary

One Docker container. FastAPI serves the JSON API under `/api` and the statically exported Next.js app at `/`, so no Node server runs in production.

- `auth.py`: fixed `user`/`password` login, 8-hour in-memory sessions, HTTP-only SameSite Strict cookie, Origin check on state-changing routes, TrustedHost limited to loopback names.
- `board.py`: normalized SQLite (users, boards, columns, cards). The client sends the whole board with an expected revision; the server validates it and replaces the board in one `BEGIN IMMEDIATE` transaction, or returns 409.
- `ai.py`: sends the board and chat history to OpenRouter with a strict JSON schema. The model returns up to 25 `create`/`update`/`move` operations; the server applies them, validates the result and saves it with the same revision check.
- Frontend: `useBoard` serializes autosaves and tracks saving/error/conflict/expired states; `AIChatSidebar` is enabled only when the board is fully saved.

The code is small, consistent and well tested. Concurrency, CSRF, DNS rebinding and AI write scope are handled carefully. The findings below are mostly about validation edge cases, error messages and dependency hygiene.

---

## 3. Findings

### High

**H1. Frontend dependencies have critical advisories.** `npm audit` reports 25 vulnerabilities, the same count noted in Part 6 and never addressed.

- `next` 16.1.6 (critical, more than 40 advisories) is fixed in 16.4.6, a non-major upgrade. `postcss` and `sharp` are fixed by the same upgrade.
- `vitest` and `@vitest/coverage-v8` 3.2.4 (critical, through `tinypool`) need vitest 4.1.11 or later, a major upgrade. `vite`, `rollup`, `ws`, `zod` and others are fixed by `npm audit fix`.

Runtime exposure is limited. The container serves only static files, so the Next.js server-side advisories (Server Actions, image optimization, middleware, caching) do not reach it. The exposure is the developer machine: `npm run dev`, the Vite server Vitest starts, and the build. The fix is cheap, and the project standard is to use current library versions.

Fix: upgrade `next` and `eslint-config-next` to 16.4.6, run `npm audit fix`, upgrade Vitest to the current major, then re-run all suites.

### Medium

**M1. Some server rejections leave the user in a save loop they cannot leave.** The frontend does not check everything the server enforces. When the server returns 422, `useBoard` shows the generic "Unable to save" with a "Retry save" button, and retrying resends the same invalid board ([useBoard.ts:116-121](../frontend/src/lib/useBoard.ts#L116-L121)). There is no 422 handling anywhere in `src/`. Two realistic triggers:

- **Legacy tab import.** The old tab-only UI allowed blank column titles and had no length limits. `isBoardData` ([boardStorage.ts:127-155](../frontend/src/lib/boardStorage.ts#L127-L155)) checks neither, but the server rejects both ([board.py:37](../backend/app/board.py#L37), [board.py:49-50](../backend/app/board.py#L49-L50)). Importing such a board fails on every retry, and the user is not told which field is wrong.
- **Card limit race.** `NewCardForm` only disables the "Add a card" button at the limit ([NewCardForm.tsx:300](../frontend/src/components/NewCardForm.tsx#L300)). With 499 cards, forms already open in two columns can each add a card, so the board reaches 501 and is rejected.

Fix:

- Make `isBoardData` reject blank column titles and over-limit fields and counts, so an invalid legacy board is reported as invalid instead of imported.
- Treat 422 as its own status: show the server's message and offer "Load latest board" (discarding the invalid change) instead of a retry that cannot succeed.

**M2. AI error messages misreport the cause.** In [ai.py:116-120](../backend/app/ai.py#L116-L120), every HTTP 400 on a chat request is reported as "the configured model or provider may not support the requested schema". In [ai.py:169-173](../backend/app/ai.py#L169-L173), a timeout is reported as "Could not reach OpenRouter. Check network connectivity."

The size limits allow a board of about 2.7 MB of JSON, far beyond a free model's context window. A large board therefore gets a context-length 400 that is shown as a schema problem. A slow free model hitting the 20-second timeout is shown as a network problem. Both point the user at the wrong cause, the trap project standard 4 warns about.

Fix:

- For 400 responses, pass through OpenRouter's error message (`error.message` in the response body) instead of guessing.
- Give timeouts their own message.
- Consider a cap on the prompt size, with a clear error when the board is too large to send.

**M3. Stored data that fails current validation makes the board unreadable.** `read_board` builds validated `Card`, `Column` and `Board` models from database rows ([board.py:120-137](../backend/app/board.py#L120-L137)). Any row that breaks the current limits makes `GET /api/board` and chat return 500. Examples are a title over 200 characters saved before the limits existed, or a future change to the fixed columns. The UI then shows "Unable to load the board" with no way to recover.

The previous review noted this (its L5 and "Notes for later") but left it open. Blank column titles already have a read-time fallback; other limits do not.

Fix: add a schema-version-2 migration in `initialize_database` that repairs or truncates rows breaking the limits, so reads can stay strict.

### Low

**L1. The session cookie is shared by everything on `127.0.0.1`.** Browsers do not isolate cookies by port, and the cookie is always named `kanban_session` ([auth.py:9](../backend/app/auth.py#L9)). Two effects:

- Any other local web service the browser visits receives the cookie. `HttpOnly` stops scripts reading it, but not the browser sending it.
- Signing in to a test container (for example on port 8766) overwrites the main app's cookie, which then reports "Session expired".

This is acceptable for a local MVP. Document it, or include the port in the cookie name.

**L2. The browser-test board reset has a soft guard.** `resetTestBoard` ([board-test-setup.ts:5](../frontend/tests/board-test-setup.ts#L5)) checks only that `KANBAN_ISOLATED_TEST=1` and `PLAYWRIGHT_BASE_URL` are set. If `PLAYWRIGHT_BASE_URL` is `http://127.0.0.1:8765`, the tests wipe the real board. The restart test checks the container name, but the reset does not.

Fix: refuse to reset when the base URL uses the Compose port 8765.

**L3. A generated file is tracked in git.** `frontend/test-results/.last-run.json` is Playwright output, `frontend/.gitignore` does not ignore `test-results/`, and `frontend/AGENTS.md` describes the file as if it belonged in the repo.

Fix: remove it from git and ignore the directory.

**L4. Saving an unchanged card edit still writes.** `handleEditCard` ([KanbanBoard.tsx:126-131](../frontend/src/components/KanbanBoard.tsx#L126-L131)) always creates a new board object, so an unchanged Save sends a `PUT` and bumps the revision. Return the existing board when nothing changed.

**L5. `updateBoard` reads a stale `status`** ([useBoard.ts:129](../frontend/src/lib/useBoard.ts#L129)). This is carried over from the previous review's L8 and is still mitigated by `<fieldset disabled>`. A ref mirror of `status`, like the existing `blocked` ref, would remove the dependency.

### Documentation

- **D1.** [database-approach.md](database-approach.md) is stale:
  - It says column titles may be empty; they are now rejected.
  - It says new cards store "No details yet."; they now store `""`.
  - It omits the size limits and the 4 MiB body limit.
  - It describes AI output as a full board ("validate the structured output against the same rules"); it is now a list of operations.
- **D2.** [PLAN.md](PLAN.md):
  - Line 5 says "Part 7 is awaiting user review", but every Part 7 item is checked.
  - It does not mention the post-review changes.
  - Its vulnerability note still says the counts have not been reverified (see H1 for the current counts).
- **D3.** `CLAUDE.md` was added on 2026-11-23 and is not yet committed.

---

## 4. Status of the 2026-11-19 review

| Item | Status |
|---|---|
| H1 `httpx2` provenance | Verified legitimate; no change |
| H2 AI could delete or rewrite the board | Fixed: operation-based contract with no delete |
| H3 No size limits | Fixed; see M1 and M3 above for remaining edge cases |
| M1 Blank column titles | Fixed |
| M2 Request per keystroke on rename | Fixed: commit on blur or Enter |
| M3 Keyboard drag and drop | Fixed |
| M4 Plain credential compare, no rate limit | Deferred until real users |
| M5 In-memory sessions | Deferred until real users |
| M6 Root container, no healthcheck | Fixed |
| M7 Write lock on every read | Fixed, plus WAL |
| L1 Cookie without `secure` | Open; correct for plain HTTP on localhost |
| L2 Security headers | Fixed (`frame-ancestors`, `nosniff`, `Referrer-Policy`) |
| L3 Logout with expired session | Fixed |
| L4 Client-controlled chat history | Open |
| L5 Reads depend on the current seed and limits | Open; now M3 |
| L6 Placeholder stored as data | Fixed |
| L7 No confirm or undo on card removal | Open |
| L8 Stale `status` in `updateBoard` | Open; now L5 |
| L9 Dead code | Fixed |
| L10 Frontend imports a backend file | Open |
| L11 Free-tier data handling | Open; the UI discloses that data goes to OpenRouter |
| L12 Synchronous 20-second LLM call | Open; fine at this scale |

## 5. Already handled well

- `.env` is gitignored, excluded from the Docker context, and passed only to the backend container. The API key never reaches the browser, logs or error messages.
- CSRF and DNS-rebinding defence: SameSite Strict cookie, an exact Origin check, and TrustedHost.
- Optimistic concurrency covers manual edits, AI edits and the legacy import. The AI applies operations to the board it read and saves against that revision.
- The AI cannot delete cards or change columns, operations are capped at 25, and the server assigns new card IDs.
- All SQL is parameterized. Position collisions during reordering are avoided by shifting positions out of range first.
- The 4 MiB body limit covers both declared and chunked bodies.
- React renders all card and chat text as text; there is no `dangerouslySetInnerHTML`.
- The runtime image drops to a non-root user and has a healthcheck.

## 6. Suggested order of work

1. H1: upgrade Next.js, run `npm audit fix`, upgrade Vitest, re-run all suites.
2. M1: tighten `isBoardData` and handle 422 explicitly.
3. M2: report OpenRouter's real 400 message and timeouts accurately.
4. M3: add a version-2 migration that repairs over-limit rows.
5. D1 to D3: bring `database-approach.md` and `PLAN.md` up to date and commit `CLAUDE.md`.
6. L2 and L3: harden the test reset guard and untrack `test-results/`.
7. L1, L4, L5: as convenient.

---

## 7. Implementation log

Date: 2026-11-23. H1 and M1 to M3 were fixed. The Low and Documentation items remain open, except that `PLAN.md`'s vulnerability note was updated.

| Item | Result |
|---|---|
| H1 | **Done.** `next` and `eslint-config-next` were upgraded to 16.4.6, `vitest` and `@vitest/coverage-v8` to 5.1.1, `@testing-library/jest-dom` to 8 (the release for Vitest 5, now loaded through `@testing-library/jest-dom/vitest`) and `@types/node` to 24 (Vitest 5's peer range, matching the Node 24 build image). `npm audit fix` updated the remaining transitive packages. `npm audit` now reports 0 vulnerabilities. Three side effects of the upgrade were fixed: the newer React hooks lint rule rejects writing a ref during render, so `useBoard` now updates its callback ref in an effect; the jest-dom type reference changed; and `next build` 16.4 type-checks test files, one of which imports `docs/database-schema.json` from outside the Docker build context, so the build now uses `tsconfig.build.json`, which excludes tests (`tsc --noEmit` still checks them). |
| M1 | **Done.** `isBoardData` mirrors the backend rules: blank column titles, text and ID length limits counted in code points as Python does, and the 500-card cap. An invalid tab board is now reported as invalid instead of being offered for import. A 422 response puts `useBoard` into a new `invalid` status that shows the server's message and offers both "Retry save" (after the user corrects the board) and "Load latest board" (to discard the change). `handleAddCard` ignores additions at the card limit, which closes the race with forms opened earlier. |
| M2 | **Done.** For an HTTP 400, the response now includes OpenRouter's own `error.message`, truncated to 300 characters. Without one, the message says that no reason was given, instead of guessing at a schema problem. Timeouts, both read timeouts and connect timeouts wrapped in `URLError`, return 504 with their own message. Other provider errors keep their previous mapping and still do not echo provider text. |
| M3 | **Done.** `SCHEMA_VERSION` is now 2. At startup, a version 1 database is migrated: column titles, card titles and details are truncated to the limits, and blank column titles are restored to their defaults, all in the same transaction as the version bump. The read-time fallback for blank column titles was removed because the migration covers it. Not repaired: more than 500 cards on one board, or card IDs over 64 characters. Neither can be fixed without deleting or renaming data, and both were only reachable through direct API calls before the limits existed. A read-only check of a copy of the local `board-data` database found 1 board, 8 cards and no rows outside the limits, so on that database the migration only changes the version number. |

### Verification

| Check | Result |
|---|---|
| `npm audit` | 0 vulnerabilities |
| `npm run lint`, `tsc --noEmit` | Clean |
| Vitest | 36 passed (7 new: invalid tab boards ×4, code-point counting, 422 handling, card-limit race). A mutation check confirmed the card-limit test fails without the guard. |
| `docker build --target test` | Frontend export built with Next.js 16.4.6; 69 backend tests passed (new: version 1 migration, provider 400 message, read and connect timeouts) |
| Local `npm run build` | Passed |
| Playwright (Edge), isolated container and fresh volume | `migration.spec.ts` 1 passed; full suite 19 passed, 1 skipped (the migration spec without `KANBAN_FRESH_TEST`), including the real container restart. The fresh database was created at `user_version` 2. |

No live OpenRouter request was made; the changed error paths are covered by mocked tests.
