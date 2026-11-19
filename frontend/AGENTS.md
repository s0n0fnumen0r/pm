# Frontend

This is the existing Kanban demo, statically exported and served by FastAPI in Docker. Follow the project-level `AGENTS.md` and `docs/PLAN.md`.

## Overview

This is a Next.js App Router application using React, TypeScript, and Tailwind CSS. After local sign-in, its single page displays a Kanban board with five fixed, renameable columns. The demo supports adding and removing cards and dragging them within or between columns. Board data is held in React state and temporarily saved to the current tab's session storage; there is no card-editing UI, persistent board API, database storage, or AI chat yet.

The rendering and data flow is:

1. `src/app/layout.tsx` wraps `src/app/page.tsx`, which renders `AuthGate`.
2. `AuthGate` checks the backend session, displays sign-in or an error as needed, and renders `KanbanBoard` only when signed in.
3. `KanbanBoard` initializes and owns the board state, renders columns, and passes data and callbacks down.
4. Each `KanbanColumn` renders sortable `KanbanCard` components and a `NewCardForm`. Their callbacks update the board in `KanbanBoard`.
5. dnd-kit supplies drag events; `moveCard` computes the new ordered column contents, and `KanbanCardPreview` appears during a drag.

## Application entry and styling

- **`src/app/page.tsx`**: The `/` route; renders the authentication gate.
- **`src/app/layout.tsx`**: Root HTML layout, page title and description. Loads the Manrope body font and Space Grotesk display font using `next/font/google`, and imports the global stylesheet.
- **`src/app/globals.css`**: Imports Tailwind CSS and defines the project color, surface, border, shadow, and font variables. Applies global body styles and the `font-display` class; most component styling is expressed with Tailwind utilities.
- **`src/app/favicon.ico`**: The app's browser icon, picked up by the App Router.

## Components

- **`AuthGate`** (`src/components/AuthGate.tsx`): Checks `/api/session` on load, displays sign-in, handles `/api/login` and `/api/logout`, and reports authentication or connectivity errors. It renders the board only for a server-verified session; the session cookie is managed by the backend.
- **`KanbanBoard`** (`src/components/KanbanBoard.tsx`): The client-side board container. It initializes `BoardData` from tab storage or the demo, reports storage failures, tracks the card being dragged, and renders the page header and one `KanbanColumn` per column. It owns the handlers for renaming columns, adding cards, removing cards, and moving cards, and saves each change to tab storage. New cards receive an ID from `createId`; empty details become `No details yet.` It sets up a dnd-kit `DndContext` with a pointer sensor, pointer-first collision detection with a closest-corners fallback, and a `DragOverlay`. On drag end it delegates ordering to `moveCard`; dropping without a target or onto the same card does nothing.
- **`KanbanColumn`** (`src/components/KanbanColumn.tsx`): Receives a column, its resolved card objects, and callbacks for renaming, adding, and deleting. It registers the column as a drop target, displays the card count and an editable column title, and renders cards in a vertical `SortableContext`. Empty columns show a drop prompt. Its `NewCardForm` forwards new card values with the column ID.
- **`KanbanCard`** (`src/components/KanbanCard.tsx`): Receives a card and an `onDelete` callback. It registers the card with `useSortable`, applies drag transforms and dragging styles, and displays the card title, details, and a remove button. The button invokes `onDelete` with the card ID.
- **`KanbanCardPreview`** (`src/components/KanbanCardPreview.tsx`): Receives a card and renders a non-interactive title and details preview inside the board's drag overlay.
- **`NewCardForm`** (`src/components/NewCardForm.tsx`): Receives an `onAdd` callback and manages its own open/closed state and title/details inputs. Submission requires a non-blank title, trims both values, calls `onAdd`, and resets and closes the form. Cancel also resets and closes it.

The board data shape separates ordered columns and their `cardIds` from the card lookup. `moveCard` handles reordering within a column and moving between columns; the column and card components communicate changes through callbacks rather than maintaining their own board data.

## Board data and logic

- **`src/lib/kanban.ts`**:
  - `Card` has an ID, title, and details. `Column` has an ID, title, and ordered list of card IDs. `BoardData` contains the ordered columns and a card lookup keyed by ID.
  - `initialData` supplies the five demo columns—Backlog, Discovery, In Progress, Review, and Done—and eight example cards.
  - `moveCard` resolves the source and target from card or column IDs and returns updated column arrays. It supports reordering over a card and appending to a column, including an empty one; invalid or unchanged moves leave the input unchanged.
  - `createId` combines a prefix, random text, and a timestamp to generate IDs for cards created in the demo.
- **`src/lib/boardStorage.ts`**: Reads and validates the current tab's session-storage board and saves updates. Invalid or unavailable storage is reported without overwriting the saved data. This temporary single-user approach does not replace the planned database.

## Tests

- **`src/lib/kanban.test.ts`**: Vitest tests for reordering, moving between columns, dropping into empty or existing columns, and invalid moves.
- **`src/components/KanbanBoard.test.tsx`**: Testing Library tests for rendering five columns, renaming a column, adding and removing a card, and validating and cancelling the add-card form.
- **`src/test/setup.ts`**: Loads `@testing-library/jest-dom` matchers for unit tests.
- **`src/test/vitest.d.ts`**: Adds Vitest and jest-dom type references for test files.
- **`tests/kanban.spec.ts`**: Playwright browser tests for loading the board, renaming a column, adding and removing a card, and moving cards within and between columns, including empty columns. Also checks static assets and API routing.
- **`tests/auth.spec.ts`**: Playwright tests for sign-in, session refresh, sign-out, expiration messages, failed requests, and board retention in the current tab.
- **`vitest.config.ts`**: Configures the React plugin, jsdom, test globals, setup file, `src` test-file matching, the `@` alias, and text/HTML coverage reporters. Excludes the separate Playwright tests.
- **`playwright.config.ts`**: Runs the `tests/` suite against the running Docker app at `http://127.0.0.1:8765` by default. `PLAYWRIGHT_BASE_URL` targets another existing server; `PLAYWRIGHT_BROWSER_CHANNEL` can select an installed Chrome or Edge. Failure traces are retained.
- **`test-results/.last-run.json`**: Playwright's recorded last-run status, not application source or a substitute for running tests.

## Configuration and assets

- **`package.json`**: Declares the npm scripts and dependencies. Runtime dependencies include Next.js, React, dnd-kit, and `clsx`; development dependencies include TypeScript, Tailwind/PostCSS, ESLint, Vitest/Testing Library, and Playwright.
- **`package-lock.json`**: npm's locked dependency tree for reproducible installs; keep it synchronized with `package.json`.
- **`next.config.ts`**: Enables the static export written to `out/`. Docker copies that export into the FastAPI image.
- **`tsconfig.json`**: Enables strict TypeScript checking, Next.js types, and the `@/*` alias to `src/*`; TypeScript does not emit application files.
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

TypeScript uses the `@/` alias for `src/`. Preserve the existing design and interactions when integrating the backend.
