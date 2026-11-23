# Frontend

This is the existing Kanban demo with an AI chat sidebar, statically exported and served by FastAPI in Docker. Follow the project-level `AGENTS.md` and `docs/PLAN.md`.

## Overview

This is a Next.js App Router application using React, TypeScript, and Tailwind CSS. After local sign-in, its single page displays a persistent Kanban board with five fixed, renameable columns and an AI chat sidebar. Users can add, edit, remove, and drag cards within or between columns. The authenticated backend API stores the board in SQLite and handles AI chat updates.

The rendering and data flow is:

1. `src/app/layout.tsx` wraps `src/app/page.tsx`, which renders `AuthGate`.
2. `AuthGate` checks the backend session, displays sign-in or an error as needed, and renders `KanbanBoard` only when signed in.
3. `KanbanBoard` uses `useBoard` to load and save state through the board API, renders columns and `AIChatSidebar`, and passes data and callbacks down.
4. `AIChatSidebar` keeps conversation history in the current page session, sends messages to the authenticated AI API, and applies the returned board and revision through `useBoard`.
5. Each `KanbanColumn` renders sortable `KanbanCard` components and a `NewCardForm`. Their callbacks update the board in `KanbanBoard`.
6. dnd-kit supplies drag events; `moveCard` computes the new ordered column contents, and `KanbanCardPreview` appears during a drag.

## Application entry and styling

- **`src/app/page.tsx`**: The `/` route; renders the authentication gate.
- **`src/app/layout.tsx`**: Root HTML layout, page title and description. Loads the Orbitron display, Chakra Petch body and JetBrains Mono fonts using `next/font/google`, imports the global stylesheet, and renders the fixed decorative backdrop (neon haze, grid floor, scanlines) behind the page.
- **`src/app/globals.css`**: Imports Tailwind CSS and defines the dark cyberpunk theme: color variables, the backdrop and scan beam, and shared classes in `@layer components` (`hud-panel`, `cyber-card`, `cyber-btn`, `icon-btn`, `cyber-input`, `glitch`, `status-dot`) so Tailwind utilities can still override them. Animations are disabled under `prefers-reduced-motion`.
- **`src/app/favicon.ico`**: The app's browser icon, picked up by the App Router.

## Components

- **`AuthGate`** (`src/components/AuthGate.tsx`): Checks `/api/session` on load, displays sign-in, handles `/api/login` and `/api/logout`, and reports authentication or connectivity errors. It renders the board only for a server-verified session; the session cookie is managed by the backend.
- **`KanbanBoard`** (`src/components/KanbanBoard.tsx`): The board container. It displays loading, save, conflict, session-expiration, and legacy-import states; tracks drag and card-edit drafts; and owns board mutation callbacks. It prevents ordinary sign-out with unsaved changes, offers reauthentication and retry on session expiry, and warns before leaving with unsaved work. New cards receive a UUID; empty details stay empty and the card shows `No details yet.` at render time. Its dnd-kit context uses a pointer sensor and a keyboard sensor, pointer-first collision detection with a closest-corners fallback, and a `DragOverlay`. Adding cards is disabled at the 500-card limit.
- **`AIChatSidebar`** (`src/components/AIChatSidebar.tsx`): Displays the current chat, sends the latest message with prior conversation history, reports pending and API errors, and syncs validated board revisions returned by the backend. Chat is disabled while board edits are unsaved or a request is pending.
- **`KanbanColumn`** (`src/components/KanbanColumn.tsx`): Receives a column, its resolved card objects, and callbacks for renaming, adding, editing, and deleting. It registers the column as a drop target, displays its number, accent color (cycled by index), the card count and an editable column title (a local draft committed on blur or Enter; Escape or a blank value reverts), and renders cards in a vertical `SortableContext`. Empty columns show a drop prompt. Its `NewCardForm` forwards new card values with the column ID.
- **`KanbanCard`** (`src/components/KanbanCard.tsx`): Registers a sortable card and displays its title, details, and icon-only edit and delete buttons (labelled `Edit <title>` / `Delete <title>`). Its inline edit form validates a non-blank title, permits cancelling, and disables dragging while open. Edit-draft state is reported to the board.
- **`KanbanCardPreview`** (`src/components/KanbanCardPreview.tsx`): Receives a card and renders a non-interactive title and details preview inside the board's drag overlay.
- **`icons`** (`src/components/icons.tsx`): Small inline SVG icons (edit, delete, plus, send, power), hidden from assistive technology; buttons carry the accessible name.
- **`NewCardForm`** (`src/components/NewCardForm.tsx`): Receives an `onAdd` callback and manages its own open/closed state and title/details inputs. Submission requires a non-blank title, trims both values, calls `onAdd`, and resets and closes the form. Cancel also resets and closes it.

The board data shape separates ordered columns and their `cardIds` from the card lookup. `moveCard` handles reordering within a column and moving between columns; the column and card components communicate changes through callbacks rather than maintaining their own board data.

## Board data and logic

- **`src/lib/kanban.ts`**:
  - `Card` has an ID, title, and details. `Column` has an ID, title, and ordered list of card IDs. `BoardData` contains the ordered columns and a card lookup keyed by ID.
  - `initialData` imports `backend/app/initial_board.json`, shared with the backend, containing five demo columns—Backlog, Discovery, In Progress, Review, and Done—and eight example cards.
  - `moveCard` resolves the source and target from card or column IDs and returns updated column arrays. It supports reordering over a card and appending to a column, including an empty one; invalid or unchanged moves leave the input unchanged.
  - `createId` generates UUIDs for new cards.
- **`src/lib/useBoard.ts`**: Loads and validates the authenticated board, serializes revision-checked writes, reports a server rejection (422) with its message and offers retry or loading the latest board, accepts validated server board/revision responses from AI chat, retains unsaved edits on errors, and handles retries, conflicts, and legacy import.
- **`src/lib/boardStorage.ts`**: Validates API board data against the same rules as the backend, including blank column titles and size limits counted in characters, and reads the old tab-storage board for optional import. It retains the old data and records whether the user handled the import prompt.

## Tests

- **`src/lib/kanban.test.ts`**: Vitest tests for demo seed consistency with the approved database schema, reordering, moving between columns, dropping into empty or existing columns, and invalid moves.
- **`src/components/AIChatSidebar.test.tsx`**: Testing Library tests for conversation history, pending and error states, conflict handling, and applying returned board data.
- **`src/components/KanbanBoard.test.tsx`**: Testing Library tests for API loading, mutations, serialization, editing, errors, conflicts, session expiry, legacy import, and AI board updates.
- **`src/test/setup.ts`**: Loads the `@testing-library/jest-dom/vitest` matchers for unit tests.
- **`src/test/vitest.d.ts`**: Adds Vitest and jest-dom type references for test files.
- **`tests/kanban.spec.ts`**: Playwright browser tests for board interactions and AI chat answers and updates using deterministic API mocks. Also checks static assets and API routing.
- **`tests/auth.spec.ts`**: Playwright tests for sign-in, session refresh, sign-out, expiration messages, failed requests, and board persistence across tabs.
- **`tests/persistence.spec.ts`**: Playwright tests for concurrent-tab conflicts and persistence across an isolated container restart.
- **`tests/migration.spec.ts`**: Tests legacy import against a fresh isolated database when `KANBAN_FRESH_TEST=1`; run it before other tests reset the board.
- **`tests/board-test-setup.ts`**: Resets the test board before browser tests; requires explicit isolated-test opt-in. Never point it at a board containing user data.
- **`vitest.config.ts`**: Configures the React plugin, jsdom, test globals, setup file, `src` test-file matching, the `@` alias, and text/HTML coverage reporters. Excludes the separate Playwright tests.
- **`playwright.config.ts`**: Runs the `tests/` suite sequentially. Browser tests reset the board and require `KANBAN_ISOLATED_TEST=1` and an isolated `PLAYWRIGHT_BASE_URL`; `PLAYWRIGHT_BROWSER_CHANNEL` can select an installed Chrome or Edge. The restart test additionally requires `KANBAN_TEST_CONTAINER_ID` for a container named with the `kanban-part7-test-` prefix. Failure traces are retained.
- **`test-results/.last-run.json`**: Playwright's recorded last-run status, not application source or a substitute for running tests.

## Configuration and assets

- **`package.json`**: Declares the npm scripts and dependencies. Runtime dependencies include Next.js, React, dnd-kit, and `clsx`; development dependencies include TypeScript, Tailwind/PostCSS, ESLint, Vitest/Testing Library, and Playwright.
- **`package-lock.json`**: npm's locked dependency tree for reproducible installs; keep it synchronized with `package.json`.
- **`next.config.ts`**: Enables the static export written to `out/` and sets the Turbopack root to the project root so the shared backend seed can be imported. Docker copies that export into the FastAPI image.
- **`tsconfig.json`**: Enables strict TypeScript checking, Next.js types, and the `@/*` alias to `src/*`; TypeScript does not emit application files.
- **`tsconfig.build.json`**: Used by `next build` (see `next.config.ts`) to type-check application code only; the tests import files outside the Docker build context and are checked by `tsc --noEmit` instead.
- **`eslint.config.mjs`**: Uses the Next.js core-web-vitals and TypeScript rule sets and ignores generated build paths.
- **`postcss.config.mjs`**: Enables the Tailwind CSS PostCSS plugin.
- **`.gitignore`**: Excludes dependencies, Next.js build output, coverage, environment files, and other generated or local files. `next-env.d.ts` is generated by Next.js and ignored; it is referenced by `tsconfig.json` and may not exist until Next.js runs.
- **`public/`**: Static assets served from the site root. It currently contains `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, and `window.svg`; the current source does not reference them.
- **`README.md`**: Short npm installation, development, and test instructions.
- **`AGENTS.md`**: This frontend overview and guidance. The project-level instructions and plan remain authoritative.

Generated directories such as `node_modules/`, `.next/`, `out/`, and `coverage/` may appear after installing, building, or testing; they are not hand-maintained frontend source.

## Commands

Run from `frontend/`:

- `npm install` installs the dependencies described by the npm manifest and lockfile.
- `npm run dev` starts the Next.js development server, but it does not provide the authentication API; use the Docker app for the complete sign-in flow.
- `npm run build` generates the static export in `out/`; use the project Docker workflow to serve it with the API. `next start` does not support static exports.
- `npm run lint` runs ESLint.
- `npm test` and `npm run test:unit` run Vitest once; `npm run test:unit:watch` runs it in watch mode.
- `npm run test:e2e` runs Playwright; `npm run test:all` runs unit tests followed by browser tests.

TypeScript uses the `@/` alias for `src/`. Preserve the dark cyberpunk design and existing interactions. The board header is a compact bar; columns use a five-column grid from `lg`, and the chat sits beside the board as a sticky panel from `2xl` (below the board on smaller screens).
