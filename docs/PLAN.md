# Project Management MVP plan

## Scope and decisions

- One local Docker container serves the static Next.js frontend and FastAPI API. The MVP login is `user` / `password`; the data model supports multiple users and one board per user.
- New users receive the existing demo board, including its five columns and cards. Existing boards are never re-seeded on restart.
- The current demo supports login, renaming columns, adding and removing cards, and drag-and-drop; editing existing cards, durable persistence, and AI chat still need to be added.
- Until database integration, board changes are temporarily kept in the current browser tab's session storage across refresh and sign-out; they are not shared or durable.
- Recommendation for Part 5: use SQLite tables for users, boards, columns, and cards, including explicit ordering and ownership. Document the proposed schema as JSON and exchange boards as JSON through the API. This is a recommendation, not an approved schema; obtain separate sign-off in Part 5.
- Keep the OpenRouter key server-side. The configured model is `nvidia/nemotron-3-ultra-550b-a55b:free`; verify its availability and Structured Outputs support rather than assuming either.
- Preserve the existing visual style and the color scheme in the project instructions. Keep the README concise.

## Part 1: Plan

- [x] Review the project instructions and existing frontend.
- [x] Expand this plan with implementation steps, tests, and success criteria.
- [x] Describe the existing frontend in `frontend/AGENTS.md`.
- [x] Obtain user approval of this plan before starting Part 2.

**Validation:** Review the plan against the requirements and inspect the frontend documentation against the existing code.

**Success:** The user approves the implementation plan; no implementation has started.

## Part 2: Scaffolding

- [x] Set up a FastAPI backend and `uv`-managed Python dependencies; update `backend/AGENTS.md` to describe the actual backend.
- [x] Create Docker packaging and a persistent storage location for the future SQLite database. Keep `.env`, the API key, and database files out of the image and version control.
- [x] Serve a temporary hello-world page at `/` and a small example API endpoint from the same container; ensure API routes are not swallowed by static serving.
- [x] Add start and stop scripts for Windows, macOS, and Linux in `scripts/`, with clear errors and instructions. Stop the app without deleting persistent data.
- [x] Document prerequisites, startup, shutdown, and data location in the README.

**Tests:** Backend tests for the example API and static page; build and run the container, request both endpoints, stop and restart it. Exercise scripts on available platforms and report any untested platforms.

**Results:** Three backend tests passed in the Docker test stage. The container page and API were checked over HTTP; the browser displayed the API response, and the page's success, HTTP-error, and network-error handling were tested. A volume marker survived stop and restart with both PowerShell and shell scripts; it was then removed. PowerShell was tested on Windows and the shell scripts under Git Bash on Windows; native macOS and Linux remain untested. The runtime image was checked for the root `.env` and OpenRouter key.

**Success:** The container starts locally, `/` serves the example page, the API responds, and the scripts stop and restart it without deleting data.

## Part 3: Add the frontend

- [x] Configure a static Next.js export and include the built output in the Docker image; replace the temporary page with the existing demo at `/`.
- [x] Preserve the current demo interactions, styling, and asset loading. Keep the API reachable alongside static files.
- [x] Update documentation and frontend instructions for the actual build and serving workflow.

**Tests:** Run frontend lint, unit tests, and production build. Add or extend integration/browser tests for the container-served page, static assets, API routing, column rename, card add/remove, and drag-and-drop.

**Results:** Frontend lint and all 10 unit tests passed. The Docker production export built successfully and all 3 backend tests passed. All 5 Playwright tests passed against the container using installed Microsoft Edge, including assets, API routing, renaming, add/remove, and drag-and-drop.

**Success:** The container serves the working demo and its assets at `/`, its existing interactions work, and the API remains reachable.

## Part 4: Add a fake user sign-in experience

- [x] Add a login screen and logout for the specified dummy credentials; show the board only after successful login.
- [x] Implement a server-verified session suitable for local use, and protect the board APIs as they are introduced. Use an HTTP-only, same-site session cookie and address cross-site requests; do not treat client-only state as authorization.
- [x] Show clear errors for invalid credentials and expired or failed sessions. Document that the fixed credentials and local-only setup are not production authentication.

**Tests:** Cover correct and incorrect credentials, missing or invalid sessions, logout, and attempts to access protected APIs; exercise login, refresh, and logout in browser tests.

**Results:** Seven backend tests passed, including credential, session, logout, expiration, and cross-origin checks. Thirteen browser tests passed using Edge, including login, refresh, logout, failure handling, and existing board interactions. Frontend lint, 10 unit tests, and the Docker production build passed. No board API exists yet; future board endpoints must require the server session.

**Success:** A fresh visit requires login, valid credentials open the board, invalid credentials do not, and logout prevents further authenticated access.

## Part 5: Database modeling

- [ ] Propose a JSON schema document for users, one board per user, fixed renameable columns, cards, and their ordering; include ownership, identifiers, constraints, and initial demo data.
- [ ] Document the SQLite representation, initialization, persistence, and how the API's board JSON maps to it. Explain the recommendation and alternatives without implementing the schema yet.
- [ ] Review how updates avoid losing concurrent board changes, including AI updates.
- [ ] Obtain explicit user sign-off on the schema and database approach before Part 6.

**Validation:** Check the proposal against the current board data shape and every required create, edit, move, rename, delete, ordering, and per-user access operation.

**Success:** The schema and database approach are documented in `docs/` and approved by the user.

## Part 6: Backend

- [ ] Implement the approved schema and automatic SQLite initialization. Use persistent container storage and create the demo board only when a user first needs a board.
- [ ] Add authenticated API routes to read and update the signed-in user's board, including card creation, editing, movement, deletion, column renaming, and ordering. Enforce the fixed-column and one-board-per-user rules.
- [ ] Validate input and ownership, return clear errors, and make related changes atomic. Define a revision/conflict mechanism so stale updates do not silently overwrite newer data.
- [ ] Document the API, database location, and initialization behavior.

**Tests:** Backend unit and API integration tests with isolated temporary databases: first initialization, demo seeding, no reseeding, each operation and ordering, invalid input, unauthorized access, user isolation, transaction rollback, and stale-update conflicts. Verify persistence across a container restart.

**Success:** The authenticated API can read and modify the correct board safely, and data survives restarts.

## Part 7: Frontend and backend

- [ ] Replace in-memory demo state with authenticated API loading and mutations while preserving the existing board experience.
- [ ] Add an interface for editing card titles and details; retain adding, deleting, renaming, and drag-and-drop.
- [ ] Handle loading, failed saves, session expiry, and conflicts visibly without presenting unsaved edits as persisted. Refresh or reconcile the board after conflicts.

**Tests:** Frontend unit/integration tests for loading, editing, mutations, errors, and conflicts; browser tests for login, all board operations, reload, logout/login, and persistence after container restart.

**Success:** All required board interactions persist, survive reload and restart, and failures are visible to the user.

## Part 8: AI connectivity

- [ ] Add a server-side OpenRouter client using the configured model and the root `.env` key, without exposing the key to the browser or logs.
- [ ] Implement a simple `2+2` connectivity check and surface configuration, network, provider, and model errors clearly.
- [ ] Document configuration and the fact that requests send data to OpenRouter.

**Tests:** Mock provider responses and failures in automated backend tests. Run a separately identified live `2+2` check when a key and network access are available; report failures or unavailable access rather than treating a mock as proof of connectivity.

**Success:** The live configured-model check returns a correct answer, or a specific external blocker is reported; automated tests require no live credentials.

## Part 9: AI board updates

- [ ] Extend the authenticated backend chat call to send the current board JSON, the user's message, and conversation history to the configured model.
- [ ] Define and request a Structured Outputs schema containing the assistant response and an optional board update. Verify provider/model support during the live check; do not silently substitute an unstructured response.
- [ ] Validate proposed updates against the approved board schema, ownership, fixed columns, and ordering; apply valid updates atomically and reject stale or invalid updates without changing the board.
- [ ] Return the assistant response and the resulting board or revision to the frontend. Surface provider, validation, and conflict errors.

**Tests:** Mock no-update and multi-card create/edit/move responses, conversation context, invalid structured output, provider failures, unauthorized access, and concurrent board updates. Perform a live Structured Outputs check when available.

**Success:** Chat answers can be returned without a board change, valid AI changes persist atomically, and invalid or stale changes cannot silently alter the board.

## Part 10: AI chat sidebar

- [ ] Add a polished, responsive sidebar consistent with the existing color scheme, with message history, input, and a pending state.
- [ ] Connect it to the authenticated chat API and refresh the board automatically after an AI update; preserve the conversation for the current chat session.
- [ ] Display errors and conflicts clearly, and keep board and chat usable on smaller screens.
- [ ] Update concise usage documentation.

**Tests:** Frontend tests for conversation history, pending/error states, and board refresh; browser tests for an answer without changes and a multi-card AI update using a deterministic mocked provider. Where available, perform a live end-to-end smoke test.

**Success:** The user can chat from the sidebar, see responses, and immediately see persisted AI board changes; failures are visible and do not misrepresent success.
