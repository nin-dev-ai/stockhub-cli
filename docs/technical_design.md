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

React Query handles data fetching and refresh intervals inside function screens. The browser calls the local Vite server, which forwards API requests to OpenBB. Most fetchers explicitly request the `yfinance` provider; treasury rates use `federal_reserve`, and symbol search uses `sec`. Provider availability and credentials affect returned data.

## Change points

- To add a function, register it in `functions.ts`, create its screen in `app/src/functions/`, and wire it in `App.tsx`.
- To change a data call or its response type, edit `api.ts` and the screens that consume it.
- To change INTEL interpretation, edit `signals.ts` and check how `INTEL.tsx` composes the signals.
- To change service ports or setup, inspect `app/vite.config.ts` and the root shell scripts together.

## Verification

Run `npm run build` from `app/` for TypeScript and production build validation. For behavior that depends on providers, run the local services and check the affected screen with representative symbols and error cases.

GitHub Actions runs the same frontend build on pushes and pull requests using Node.js 20 (`.github/workflows/frontend-build.yml`).
