# Technical design

## Runtime architecture

```text
Browser → Vite/React UI (:5173) → /api proxy → OpenBB API (:6900) → data providers
```

The shell scripts in the repository root install, start, and stop the local services. [`app/vite.config.ts`](../app/vite.config.ts) proxies `/api` to the OpenBB API. [`app/src/lib/api.ts`](../app/src/lib/api.ts) centralizes frontend requests to `/api/v1`, request parameters, response extraction, and error handling.

## Frontend map

| Area | Source | Responsibility |
| --- | --- | --- |
| Application shell | `app/src/App.tsx` | Maps function codes to screens and renders the active tab |
| Function registry and command parser | `app/src/lib/functions.ts` | Defines codes, symbol requirements, and command syntax |
| Function screens | `app/src/functions/` | Render market and ticker data |
| API client | `app/src/lib/api.ts` | Typed fetchers and API errors |
| Signal rules | `app/src/lib/signals.ts` | Classifies metrics and computes INTEL verdicts |
| Workspace state | `app/src/store/workspaceStore.ts` | Tabs and active symbol, persisted with Zustand |

React Query handles data fetching and refresh intervals inside function screens. The browser calls the local Vite server, which forwards API requests to OpenBB. Most fetchers explicitly request the `yfinance` provider; treasury rates use `federal_reserve`, and symbol search uses `sec`. Company news bypasses OpenBB: `fetchNewsCompany` reads Yahoo Finance's RSS feed, then Google News if Yahoo is empty or fails, and `app/src/lib/news.ts` parses the XML. [`vite.config.ts`](../app/vite.config.ts) proxies `/rss/yahoo` and `/rss/google` (Yahoo requires a browser `User-Agent`), so news only works through the Vite dev server. Provider availability and credentials affect returned data. The route shapes in `api.ts` target OpenBB 4.x (`/equity/price/quote?provider=...`); OpenBB 5 serves provider-first routes, so `setup.sh` pins `openbb>=4.3,<5`. Revisit the pin and `api.ts` together when migrating.

## Change points

- To add a function, register it in `functions.ts`, create its screen in `app/src/functions/`, and wire it in `App.tsx`.
- To change a data call or its response type, edit `api.ts` and the screens that consume it.
- To change INTEL interpretation, edit `signals.ts` and check how `INTEL.tsx` composes the signals.
- To change service ports or setup, inspect `app/vite.config.ts` and the root shell scripts together.

## Verification

Run `npm test` from `app/` for unit coverage of the deterministic core (signal rules in `signals.ts`, the command parser in `functions.ts`, and the formatters in `format.ts`; tests live beside the source as `*.test.ts` and run under Vitest). Run `npm run build` from `app/` for TypeScript and production build validation. For behavior that depends on providers, run the local services and check the affected screen with representative symbols and error cases.

GitHub Actions runs the same tests and frontend build on pushes and pull requests using Node.js 20 (`.github/workflows/frontend-build.yml`).
