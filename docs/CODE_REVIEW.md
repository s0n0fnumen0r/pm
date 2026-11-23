# Code Review: Kanban Studio

Date: 2026-11-23. Scope: the whole repository at commit `23688cb`, after the fixes in `aefdb7f`. This replaces the earlier review of the same day (commit `521e754`); section 4 tracks what happened to its findings.

Method: I read all backend and frontend source, the Docker, Compose and script files, the test guard and the docs, and checked each earlier finding against the current code. I ran the suites listed in section 1.

## 1. Verification performed

| Check | Result |
|---|---|
| Backend tests, `docker build --target test` | 69 passed |
| Frontend `npm run lint`, `tsc --noEmit` | Clean |
| Frontend Vitest | 36 passed |
| `npm audit` | 0 vulnerabilities |

Not run this time: Playwright, `pip-audit`, and any live OpenRouter request. The previous review ran Playwright (19 passed, 1 skipped) and `pip-audit` (clean) after the same fixes; nothing in the browser flow or Python dependencies has changed since.

## 2. Overall assessment

The code is small, consistent and well tested. The earlier High and Medium findings are fixed:

- the dependencies have no known advisories;
- the frontend mirrors the server's validation;
- a 422 has its own recoverable state;
- OpenRouter errors are reported accurately;
- older databases are migrated.

No High findings remain. One new Medium finding is in the AI path; everything else is minor or documentation.

---

## 3. Findings

### Medium

**M1. AI results that break a board rule are reported as a schema problem.** In [ai.py:318-327](../backend/app/ai.py#L318-L327), every `ValueError` from parsing the completion or applying its operations becomes the same message: "OpenRouter returned a response that did not match the required board schema."

The model can easily return output that is valid JSON for the schema but breaks a board rule. Realistic triggers:

- "Add 30 cards for the sprint": the model returns more than 25 operations (`MAX_OPERATIONS`).
- A create on a board with 495 cards would take it past 500 (`MAX_CARDS`).
- A title over 200 characters, or an update that sets a blank title.
- An assistant reply over 4000 characters (`ChatCompletion.response`).
- An unknown card or column ID.

In each case the user is told that the model or provider failed, which points at the wrong cause (project standard 4). The user is not told to ask for fewer changes or shorter text, so retrying the same request fails the same way.

Fix: keep the generic message only for output that cannot be parsed. Raise rule failures from `_apply_operations` and the `ChatCompletion` limits as their own 502 (or 422). Include the first validation message, as `useBoard`'s `errorDetail` already does for board saves. For example: "The assistant proposed 30 changes; at most 25 are allowed per request." Add a mocked test for the operation-count case and the card-limit case.

### Low

**L1. A failed "Load latest board" from the rejected-save state reports a conflict.** When `loadLatest` fails for any reason other than a 401, it always sets the status to `conflict` ([useBoard.ts:174-177](../frontend/src/lib/useBoard.ts#L174-L177)). Starting from `invalid` (a 422), a network error during reload then shows "The board changed elsewhere" ([KanbanBoard.tsx:253](../frontend/src/components/KanbanBoard.tsx#L253)). That is not what happened, and the "Retry save" button disappears. Fix: return to the previous status (`invalid` or `conflict`) on failure, and keep the existing warning text.

**L2. Saving an unchanged card edit still writes** (carried over from the previous L4). `handleEditCard` ([KanbanBoard.tsx:126-131](../frontend/src/components/KanbanBoard.tsx#L126-L131)) always builds a new board, so Save with no change sends a `PUT` and bumps the revision. That revision bump can make another tab's pending save conflict for no reason. Fix: return `prev` when the trimmed title and details match the current card; `updateBoard` already skips identical boards.

**L3. `updateBoard` reads a stale `status`** (carried over from the previous L5). The `status === "reloading"` guard ([useBoard.ts:147](../frontend/src/lib/useBoard.ts#L147)) reads render-time state. It is still mitigated by `<fieldset disabled>` and the `handleDragEnd` check. A `reloading` ref, like the existing `blocked` ref, would make the guard reliable on its own.

**L4. The browser-test board reset has a soft guard** (carried over from the previous L2). `resetTestBoard` ([board-test-setup.ts:5](../frontend/tests/board-test-setup.ts#L5)) accepts any `PLAYWRIGHT_BASE_URL`. Pointed at `http://127.0.0.1:8765` with `KANBAN_ISOLATED_TEST=1`, it wipes the real board. Fix: refuse to reset when the base URL's port is 8765.

**L5. A generated file is tracked in git** (carried over from the previous L3). `frontend/test-results/.last-run.json` is Playwright output. It is excluded from the Docker context, but neither `.gitignore` ignores it, and [frontend/AGENTS.md:61](../frontend/AGENTS.md) documents it as a repository file. Fix: run `git rm --cached` on it, add `test-results/` to `frontend/.gitignore`, and drop the AGENTS.md entry.

**L6. The session cookie is shared by everything on `127.0.0.1`** (carried over from the previous L1). Cookies are not isolated by port, and the name is always `kanban_session` ([auth.py:9](../backend/app/auth.py#L9)). Signing in to a test container on another port replaces the main app's session, and other local services receive the cookie. This is acceptable for a local MVP. Document it, or include the port in the cookie name.

### Documentation

- **D1.** [database-approach.md](database-approach.md) is still stale; none of the previous D1 points were addressed:
  - Line 11 says column titles may be empty; they are rejected.
  - Line 14 mentions the "No details yet." fallback being stored; details are now stored as `""` and the placeholder is display-only.
  - Line 18 describes the version-1 schema; the current version is 2, with a startup migration.
  - Line 43 says AI output is validated "against the same rules", as if it were a full board; it is now a list of at most 25 operations.
  - The size limits and the 4 MiB body limit are not mentioned.
- **D2.** [PLAN.md](PLAN.md) line 5 still says "Part 7 is awaiting user review" although every Part 7 item is checked. The plan also does not record the review fixes from `aefdb7f` (the 422 `invalid` state, the schema version 2 migration, and the OpenRouter error reporting).

---

## 4. Status of the earlier review (commit `521e754`)

| Item | Status |
|---|---|
| H1 Frontend dependency advisories | Fixed; `npm audit` reports 0 |
| M1 Unrecoverable 422 save loop | Fixed: `isBoardData` mirrors server rules, 422 has an `invalid` state with "Load latest board", and the card-limit race is closed |
| M2 Misleading AI error messages | Fixed for provider 400s and timeouts; rule violations in the model's output are still misreported (now M1) |
| M3 Over-limit stored data made the board unreadable | Fixed by the version 2 migration. Over 500 cards and over-long card IDs remain unrepaired by design |
| L1 Cookie shared across ports | Open; now L6 |
| L2 Soft test reset guard | Open; now L4 |
| L3 Tracked `test-results` file | Open; now L5 |
| L4 Unchanged edit writes | Open; now L2 |
| L5 Stale `status` in `updateBoard` | Open; now L3 |
| D1 `database-approach.md` stale | Open; now D1 with one more point |
| D2 `PLAN.md` stale | Partly fixed (the vulnerability note); the rest is now D2 |
| D3 `CLAUDE.md` uncommitted | Fixed |

Still deferred from the 2026-11-19 review, unchanged and acceptable for a local single-user MVP:

- plain credential comparison and no login rate limit;
- in-memory sessions;
- no `secure` cookie flag, which is correct for plain HTTP;
- client-supplied chat history;
- no confirm or undo for card removal or AI edits;
- the frontend importing `backend/app/initial_board.json`;
- free-tier data handling, which the UI discloses;
- the synchronous 20-second OpenRouter call.

## 5. Already handled well

- The API key stays server-side: `.env` is gitignored, excluded from the Docker context and passed only to the backend container. It never appears in responses or logs.
- CSRF and DNS rebinding: a SameSite Strict cookie, an exact Origin check on state-changing routes, and TrustedHost limited to loopback names. Compose binds only `127.0.0.1`.
- Optimistic concurrency covers manual saves, AI changes and the legacy import. The AI applies operations to the board it read and saves against that revision. The board is locked while a chat request is pending, so the reply cannot silently replace local edits.
- The AI cannot delete cards or change columns, and the server assigns new card IDs.
- All SQL is parameterized. Reordering avoids unique-position collisions by shifting positions out of range first. Reads do not take the write lock.
- Card and chat text is rendered as text; there is no `dangerouslySetInnerHTML`.
- The runtime image drops to a non-root user and has a healthcheck.

## 6. Suggested order of work

1. M1: separate rule violations in the model's output from unparseable output, and report the first violation.
2. D1, D2: bring `database-approach.md` and `PLAN.md` up to date.
3. L4, L5: harden the test reset guard and untrack `test-results/`.
4. L1, L2, L3: small `useBoard` and `KanbanBoard` fixes, as convenient.
5. L6: document the cookie behaviour, or include the port in the cookie name.
