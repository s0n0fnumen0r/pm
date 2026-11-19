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

Start the Docker app before running browser tests. Use an installed browser by setting `$env:PLAYWRIGHT_BROWSER_CHANNEL="msedge"` (or `"chrome"`) in PowerShell, or install Playwright's browser with `npx playwright install chromium --only-shell`.

The tests default to `http://127.0.0.1:8765`; set `PLAYWRIGHT_BASE_URL` to use another running server.
