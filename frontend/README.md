# Kanban Studio

## Run

```bash
npm install
npm run dev
```

The Next.js development server does not provide the authentication API. Use the Docker scripts in the project root for the complete app.

## Tests

```bash
npm run lint
npm run test:unit
npm run test:e2e
```

Browser tests reset the board. Run them only against a separate test container with its own disposable volume, never your normal app. Set `PLAYWRIGHT_BASE_URL` to that container, `KANBAN_ISOLATED_TEST=1`, and `PLAYWRIGHT_BROWSER_CHANNEL=msedge` (or `chrome`). For the restart test, set `KANBAN_TEST_CONTAINER_ID` to the isolated container ID; its name must start with `kanban-part7-test-`. To test the legacy import, set `KANBAN_FRESH_TEST=1` and run `npx playwright test migration.spec.ts` against a fresh isolated volume before running the rest of the suite.

The AI chat browser tests mock the chat API response and do not call OpenRouter.
