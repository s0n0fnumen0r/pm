# Database approach

Status: approved and implemented in Part 6. Frontend integration remains Part 7.

## Representation

[database-schema.json](database-schema.json) describes the SQLite tables, keys, constraints, and exact initial demo board. It is a schema specification in JSON, not a JSON Schema validator or a migration.

- `users`: stable non-empty ID and unique, case-sensitive username. The current session's authenticated username identifies the user; no password is stored in this table. Real multi-user authentication is future work.
- `boards`: ID, owner, and non-negative revision. The unique `user_id` allows at most one board per user; application initialization creates one when needed.
- `board_columns`: board-scoped ID, title, and zero-based position. Each board has exactly the five initial column IDs in their original order. Titles may be renamed, including to an empty string, as in the current UI.
- `cards`: board-scoped ID, column ID, title, details, and zero-based position within its column. The composite foreign key ensures that the column belongs to the same board. Demo card and column IDs can therefore be reused safely on different users' boards.

Use SQLite STRICT tables to enforce the declared storage types. SQLite also enforces primary keys, unique usernames, one board per user, unique positions, non-negative positions, and foreign keys with cascading deletion. Enable `PRAGMA foreign_keys = ON` on **every connection**. The service must additionally enforce exactly the five fixed column IDs in order, contiguous zero-based card positions, one occurrence of every card, matching card keys and IDs, and a non-blank card title. Card IDs must not equal any column ID because the drag-and-drop UI identifies both by ID. Column titles need not be unique. Existing details, including the demo's `No details yet.` fallback for newly created cards, remain strings.

## Initialization and lifetime

Use `/data/kanban.sqlite3`, inside the existing Compose `board-data` volume. Create the directory and database if absent. Create the version-1 schema in a transaction, record it with SQLite `user_version`, and fail visibly on initialization errors or an unsupported version. Future changes require explicit migrations.

On the first successful board access for the signed-in MVP user, create the user and, if missing, one board and the exact `initial_board` from the JSON specification in the same transaction. Both GET and PUT initialize a missing board. Use generated IDs for the user and board, preserve the demo's board-scoped column and card IDs, and assign positions from array order. A pre-existing board is never re-seeded, even if it has no cards. Later users, when authentication supports them, receive their own independent initial board.

The backend and frontend share `backend/app/initial_board.json`; a frontend test checks that it matches the approved JSON specification.

The current tab-only `sessionStorage` board is separate from the database. Do not silently overwrite an existing database board or delete tab data during the transition. In Part 7, ask the user whether to import the current tab's board; permit an import only against a seeded board still at revision 0, using that revision as the precondition. On conflict or failure, retain the tab data and show an error.

## API shape and operations

Authenticated endpoints:

- `GET /api/board`: resolve the user from the server session, create the initial board if necessary, and return `{ "revision": 0, "board": { "columns": [...], "cards": {...} } }`. Actual revision reflects the stored board. The board structure matches the current `BoardData` shape.
- `PUT /api/board`: accept `{ "revision": <expected revision>, "board": <complete BoardData> }`, validate it, atomically replace the board's mutable content, and return the new revision and board. Never accept a user or owner ID from the client. Require the existing same-origin check.

The full-board update supports creating, editing, moving, and deleting cards and renaming columns. Card order is the order of each column's `cardIds`; column order comes from `columns`. Every card key must match its `id`, and every card must occur exactly once in one column. New IDs must be unique within the board; use UUIDs for new client-created cards and server-assigned IDs for AI-created cards. Existing demo IDs stay unchanged. Reject malformed or unauthorized requests explicitly; return `401` for no valid session, `403` for a rejected origin, `422` for invalid board data, and `409` for a stale revision.

## Concurrency and integrity

Read each board and its revision from one consistent transaction. For a write, start a transaction, resolve ownership from the authenticated user, validate the entire proposed board, and compare the expected revision. Apply the data changes and increment the revision once; commit together, or roll back everything. The revision check and mutation occur within the same write transaction so competing requests cannot both succeed from the same revision.

The frontend must serialize or coalesce its own rapid edits and use the latest confirmed revision; it must not discard unsaved changes or report them as saved while a write is pending or has failed.

SQLite checks unique constraints immediately. To reorder or move cards without transient position collisions, first move existing positions to a disjoint high range within the transaction, then remove deleted cards and assign final zero-based positions and column IDs, inserting new cards as needed. Check errors and roll back rather than leaving partially applied moves.

For AI changes, include the board snapshot and revision used for the request. Validate the structured output against the same rules and apply it only if that revision still matches. On `409`, do not overwrite newer edits: report the conflict and reload or reconcile the board.

## Alternative considered

Storing each complete board as one SQLite JSON value would make reads and writes simple, but shifts ownership, card-to-column consistency, and ordering validation almost entirely into application code. Normalized tables provide database-enforced ownership and relationships while retaining the existing JSON API shape. The extra tables are limited to the four needed for this MVP.
