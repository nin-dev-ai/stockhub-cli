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

## Quant engine (Phase 2)

The strategy engine is a UI-free TypeScript library in `app/src/quant/` that runs in the browser and is tested with Vitest.

| Module | Responsibility |
| --- | --- |
| `instruments.ts` | US-ETF/USD universe, index-to-proxy map, static exposure vectors |
| `data.ts`, `dataSource.ts` | Dividend-adjusted history via OpenBB (`adjustment=splits_and_dividends`), alignment on common dates, content-hash dataset id, quality flags, local price cache |
| `strategy.ts`, `rules.ts`, `catalog.ts` | Versioned JSON strategy schema, validation (no leverage, long-only), plain-English rules generated from the definition, the 12 curated strategies |
| `backtest.ts` | Deterministic daily simulation: decide on data through close t, fill at close t+1 with slippage and fees, time-weighted returns separate from contributions, locked cash for DCA and reserves, decision and trade reasons |
| `metrics.ts`, `indicators.ts` | Metrics that return null with a reason when the sample is too short; indicators that cannot see the future |
| `robustness.ts` | Train/test split, rolling 3-year windows, parameter sensitivity, verdict |
| `service.ts` | `runBacktestOn` / `runBacktest`: validation, run id = hash(strategy, dataset, config, engine version), benchmark on identical cash flows, conventions and flags |
| `ranking.ts`, `useBacktests.ts` | Evidence-first ordering; progressive runs over one shared dataset |
| `portfolio.ts`, `overlap.ts` | Weight validation (long-only, sum to 100%), blending of strategy return streams, cash-flow paths; overlap by asset class and return correlation |
| `optimizer.ts` | Exhaustive 1% grid search over capped long-only weights for three objectives, binding constraints, baselines, out-of-sample refit |
| `projection.ts` | Seeded block-bootstrap or parametric simulation of terminal wealth: fan percentiles, real values, loss and goal probabilities, stress scenarios, refusal on short history |
| `jobs.ts`, `lab.ts`, `useLab.ts`, `report.ts` | Idempotent in-thread job queue with progress and cancellation (ids hash kind, input and engine version); Lab input validation and composition; calculation report and CSV export |

State for baskets and drafts is in `app/src/store/strategyStore.ts` and Lab inputs in `app/src/store/labStore.ts` (browser storage). Jobs run on the main thread and yield between chunks; the engine has no DOM dependency, so moving them into a Web Worker is a contained change. Run `LIVE=1 npx vitest run src/quant/live.test.ts` from `app/` to run the catalog against the local API.

## Change points

- To add a function, register it in `functions.ts`, create its screen in `app/src/functions/`, and wire it in `App.tsx`.
- To change a data call or its response type, edit `api.ts` and the screens that consume it.
- To change INTEL interpretation, edit `signals.ts` and check how `INTEL.tsx` composes the signals.
- To change service ports or setup, inspect `app/vite.config.ts` and the root shell scripts together.

## Verification

Run `npm test` from `app/` for unit coverage of the deterministic core (signal rules in `signals.ts`, the command parser in `functions.ts`, and the formatters in `format.ts`; tests live beside the source as `*.test.ts` and run under Vitest). Run `npm run build` from `app/` for TypeScript and production build validation. For behavior that depends on providers, run the local services and check the affected screen with representative symbols and error cases.

GitHub Actions runs the same tests and frontend build on pushes and pull requests using Node.js 20 (`.github/workflows/frontend-build.yml`).
