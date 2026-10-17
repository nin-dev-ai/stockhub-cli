# Working notes for maintainers and coding agents

Start with the root [README](../README.md), then use the [docs index](README.md) to find the focused document. Treat code as the source for implementation details and update the docs when code changes make them stale.

## Documentation routine

1. Identify which user flow, screen, API call, or setup step changed.
2. Update the corresponding document and any affected README section in the same change.
3. Check links and statements against current files and commands.
4. Keep notes short and current; remove superseded guidance.

## Useful source files

- `app/src/lib/functions.ts`: supported commands and parser.
- `app/src/App.tsx`: screen registration and layout.
- `app/src/lib/api.ts`: data endpoints and providers.
- `app/src/lib/signals.ts`: signal thresholds and verdict logic.
- `app/src/store/workspaceStore.ts`: tab state and persistence.
- `app/package.json`: dependencies and build commands.

## Checking the UI

`npm run e2e` (from `app/`) runs the committed Playwright suite in `app/e2e/`: every screen without page errors or horizontal overflow at 1440 and 1024 px (and the quick bar fitting at 1440), the plan flow, the Copilot cards, live persona filings and the paper-order flow. All backends are answered in the browser by `e2e/backends.ts` (fixtures and seeded synthetic prices; the clock is fixed at 16 October 2026), so it needs no market data, SEC access or broker and runs in CI as the `e2e` job. Locally it uses the installed Google Chrome; CI installs Playwright's Chromium. Add a check there when a layout or flow bug is found.

For one-off investigation beyond the suite:

1. Install `playwright-core` in a scratch folder (not in `app/`), launch the system Chrome with `executablePath` set to Google Chrome and `args: ["--headless=new"]` (Chrome removed the old headless mode), open `http://localhost:5173/`, type a function code into the first input and press Enter, then take screenshots.
2. Collect `pageerror` and console errors while doing it.
3. For IBKR and the optional LLM, run a small mock HTTP server that returns the documented gateway shapes and a fake `/v1/messages`, and start a second dev server against it: `IBKR_GATEWAY_URL=http://127.0.0.1:<port> STOCKHUB_LLM_KEY=test STOCKHUB_LLM_URL=http://127.0.0.1:<port> npx vite --port 5174`. Never point tests at a real account.
4. On macOS, port 5000 belongs to AirPlay Receiver and hangs requests; do not use it for mocks or the gateway.

## Live checks

`LIVE=1 npx vitest run src/quant/live.test.ts src/quant/livePhase3.test.ts` from `app/`, with the API and the dev server running, exercises real prices, SEC and House Clerk data.

Do not record API keys, credentials, or private user data here.
