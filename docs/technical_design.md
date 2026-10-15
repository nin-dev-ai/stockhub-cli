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

React Query handles data fetching and refresh intervals inside function screens. The browser calls the local Vite server, which forwards API requests to OpenBB. Most fetchers explicitly request the `yfinance` provider; treasury rates use `federal_reserve`, and symbol search uses `sec`. Company news bypasses OpenBB: `fetchNewsCompany` reads Yahoo Finance's RSS feed, then Google News if Yahoo is empty or fails, and `app/src/lib/news.ts` parses the XML. [`vite.config.ts`](../app/vite.config.ts) proxies `/rss/yahoo` and `/rss/google` (Yahoo requires a browser `User-Agent`) and `/clerk` (the House Clerk's disclosures), so news and House personas only work through the Vite dev server. `/ibkr` forwards to the IBKR Client Portal Gateway (`IBKR_GATEWAY_URL`, default `https://localhost:5000`, self-signed certificate accepted). Provider availability and credentials affect returned data. The route shapes in `api.ts` target OpenBB 4.x (`/equity/price/quote?provider=...`); OpenBB 5 serves provider-first routes, so `setup.sh` pins `openbb>=4.3,<5`. Revisit the pin and `api.ts` together when migrating.

## Quant engine (Phase 2)

The strategy engine is a UI-free TypeScript library in `app/src/quant/` that runs in the browser and is tested with Vitest.

| Module | Responsibility |
| --- | --- |
| `instruments.ts` | US-ETF/USD universe (about 40 ETFs grouped by asset class for pickers), index-to-proxy map, static exposure vectors |
| `data.ts`, `dataSource.ts` | Dividend-adjusted history via OpenBB (`adjustment=splits_and_dividends`), alignment on common dates, content-hash dataset id, quality flags, local price cache. An empty provider answer is retried once and never cached; a ticker that still fails becomes an empty, error-flagged series, and only strategies that trade or benchmark it refuse to run |
| `strategy.ts`, `rules.ts`, `catalog.ts` | Versioned JSON strategy schema, validation (no leverage, long-only), plain-English rules generated from the definition, the 21 curated strategies, and `retarget`, which swaps ETFs in a definition (merging weights and repeated assets that land on the same ETF) to make a variant with a new id and a caveat |
| `backtest.ts` | Deterministic daily simulation: decide on data through close t, fill at close t+1 with slippage and fees, time-weighted returns separate from contributions, locked cash for DCA and reserves, decision and trade reasons |
| `metrics.ts`, `indicators.ts` | Metrics that return null with a reason when the sample is too short; indicators that cannot see the future |
| `robustness.ts` | Train/test split, rolling 3-year windows, parameter sensitivity, verdict |
| `service.ts` | `runBacktestOn` / `runBacktest`: validation, run id = hash(strategy, dataset, config, engine version), benchmark on identical cash flows, conventions and flags |
| `ranking.ts`, `useBacktests.ts` | Evidence-first ordering; progressive runs over one shared dataset |
| `portfolio.ts`, `overlap.ts` | Weight validation (long-only, sum to 100%), blending of strategy return streams, cash-flow paths; overlap by asset class and return correlation |
| `optimizer.ts` | Exhaustive 1% grid search over capped long-only weights for three objectives, binding constraints, baselines, out-of-sample refit |
| `projection.ts` | Seeded block-bootstrap or parametric simulation of terminal wealth: fan percentiles, real values, loss and goal probabilities, stress scenarios, refusal on short history |
| `jobs.ts`, `lab.ts`, `useLab.ts`, `report.ts` | Idempotent in-thread job queue with progress and cancellation (ids hash kind, input and engine version); Lab input validation and composition; calculation report and CSV export |
| `tracking.ts`, `useTracking.ts` | Portfolio ledger (no leverage, no short sales), valuation over adjusted closes, plan targets and paper rebalancing, content-addressed frozen projection snapshots, plan replay on realized returns, attribution against a snapshot, timeline alignment, reforecast |

Allocation types: `static`, `trend` (price vs SMA), `momentum`, `vol_target`, `seasonal`, `tsmom`, `risk_parity` (inverse volatility), `multi_trend` (per-asset SMA slots), `crossover` (fast vs slow SMA), `mean_reversion` (Wilder RSI with optional trend filter) and `schedule` (dated target weights in any US ticker, stocks included; each step holds until the next and the unallocated part sits in the safe ETF; used for copy-trade backtests). Every signal uses data through the decision close only. Catalog strategies only use ETFs with history from before 2005 so the shared window stays at 2004-11-18; a test enforces this.

**Spread across ETFs.** A definition may carry `spread: { from, targets: [{ ticker, weight }] }` (up to six ETFs, weights summing to 100%). `simulate` then runs one sleeve per target (`sleeveDef` replaces `from` with the target through `applyTarget`), funds each with its weight's share of the initial capital and of every contribution, and adds the sleeves; sleeves are never rebalanced against each other, and per-trade costs apply per sleeve. Because the split happens inside `simulate`, robustness, the optimizer and projections treat a spread strategy like any other. `withSpread` builds one (equal weights by default) from the ETF the strategy trades (`primaryRisky`: the risky asset, the reserve ticker or the largest equity weight of a fixed mix); multi-asset rotations have none and cannot be spread. `quant/spread.ts` adds a `spread` section to the result: each ETF's CAGR, drawdown, Sharpe and share of the gain, the sleeves' return correlation, the same rules on the original ETF alone, buy-and-hold of the same ETFs with the same split, and whether the combined worst drawdown is shallower than the best sleeve's. With one target the run equals the plain retargeted run (tested).

State for baskets, drafts and the screen-wide ETF switch (`target`, applied by `targetedStrategies`; it only swaps ETFs a strategy trades, so one that merely benchmarks against SPY is unchanged) is in `app/src/store/strategyStore.ts`. An on-screen variant is saved as a draft when it is added to the basket so the Lab and Portfolio can resolve it by id. Lab inputs in `app/src/store/labStore.ts`, and portfolios with their snapshots in `app/src/store/portfolioStore.ts` (browser storage; snapshots are append-only and re-frozen on load). Jobs run on the main thread and yield between chunks; the engine has no DOM dependency, so moving them into a Web Worker is a contained change. Run `LIVE=1 npx vitest run src/quant/live.test.ts` from `app/` to run the catalog against the local API.

### Portfolio tracking

- **Snapshots.** A snapshot holds the inputs, weights, full strategy definitions and hashes, dataset id, plan targets and the projection's fan and percentiles. Its id is the hash of its content, so `verifySnapshot` detects any later edit, and it is deep-frozen in memory. Reforecasts are new snapshots that point to the original.
- **Valuation.** Value is cash plus units times the adjusted close. Paper trades are priced at the adjusted close; because adjusted histories are rescaled after each later dividend, paper lots are re-expressed in current adjusted units, which reinvests distributions like the backtester. Manual records use their units as entered, so cash dividends should be recorded as entries.
- **Attribution.** Observed value minus the original median = contribution difference (actual minus planned money in) + projection error (the plan's weights replayed on realized returns with the actual cash flows, versus the median path) + allocation difference (observed minus that replay). FX is not applicable while the universe is USD only.
- **Reforecast.** Re-runs the snapshot's strategies on current data, then projects from the current value with the plan's monthly contribution over the chosen horizon.

### Personas

`app/src/quant/personas.ts` defines presets with a source: `fund` (SEC CIK, Form 13F), `insider` (ticker plus first/last names, Form 4) or `house` (a US House member keyed by the Clerk's spelling of last name, first name and district). `fundChanges` aggregates 13F rows per CUSIP, security type and option type (names carry the share class, such as "Class A", so two classes of one issuer read apart), then diffs the latest two quarters into new / added / trimmed / sold-out trades. `normalizeInsider` maps Form 4 rows (transaction codes to short labels; zero prices become null), and `matchesInsider` filters a company's filings to the person. `fetchForm13F` and `fetchInsiderTrades` in `lib/api.ts` call OpenBB's SEC provider (`/equity/ownership/form_13f`, `/equity/ownership/insider_trading`); "No Form 4 data" becomes an empty list. Passing `start_date` to the insider endpoint returned no data in testing, so it is not used and the window is the provider default (about four months). `functions/PERS.tsx` makes one query per distinct source. Follows and added personas persist in `store/personaStore.ts` (version 2 resets the earlier congressional follows). `UNAVAILABLE_PEOPLE` and `POLITICIAN_NOTE` let the Copilot explain why senators and the President cannot be followed yet.

**House members.** `quant/congress.ts` parses the Clerk of the House's yearly index (`/public_disc/financial-pdfs/<year>FD.zip`, XML inside) into filings and keeps Periodic Transaction Reports (`FilingType` P). Electronically filed PTRs (document ids `2xxxxxxx`) have a text layer: `parsePtr` takes positioned text runs from every page (`quant/pdfText.ts`, pdf.js), finds the column titles of the transaction table, and rebuilds rows (owner, asset, ticker, asset-type code, transaction type, transaction and notification dates, amount range, description), continuing rows across page breaks and stopping at the footnote. Sub-headings drawn without a text mapping arrive with NUL characters and are recognised as labels. `ptrTrades` maps rows to `PersonaTrade` with `amount` holding the range and no value, shares or price; `filed` is the index filing date. A golden test parses a real three-page filing kept in `quant/fixtures/`. `lib/house.ts` fetches through the `/clerk` Vite proxy (the Clerk sends no CORS headers), unzips with fflate, lazy-loads pdf.js with its worker, reads a member's newest 24 reports from this year's and last year's index three at a time, and lists scanned paper filings, failures and older reports as links instead of guessing. The index is cached for 12 hours and parsed reports by document id indefinitely (a filed report never changes; an amendment gets a new id).

**Copy-trade backtest.** `quant/copyTrade.ts` turns a member's purchases and sales with a ticker into events (a sale is full unless the action says partial; exchanges and untickered assets are skipped and listed), then into a `schedule` allocation: on each date something changed the copy holds every stock bought and not fully sold in equal weights, otherwise SHY. It is run twice with `runBacktestOn` on one dataset (the persona's tickers plus SPY and SHY, from a month before the first trade): acting on the filing date (`filed`) and on the trade date (`traded`), both from the first trade date so the windows match. The lag cost is the difference in final value; the median filing delay, priced tickers, unpriced tickers and skipped assets are reported. A test asserts that the filing-date version never decides to buy a stock before its first report. `functions/personas/CopyTradePanel.tsx` renders it and publishes a summary to the Copilot context (`PersonasContext.copy`). Copy strategies are not saved as drafts: their stock histories would cut the Strategies screen's shared 2004+ window, and under two years of data is below the Lab's 60-month projection minimum. Funds are not offered because the 13F rows carry CUSIPs, not tickers.

### Lab ETF choice

`LabInputs.etf` (default SPY) and `labStrategies` apply `applyTarget(def, { SPY: etf })` to the basket before backtesting; when `LabInputs.alsoEtfs` lists more ETFs, strategies whose main ETF (`primaryRisky`) is SPY are spread across `[etf, ...alsoEtfs]` with `withSpread` (equal split, benchmark stays SPY) and the rest only get the swap; `CORE_ETFS` in `instruments.ts` lists the one-click choices and leads every ETF dropdown.

### Copilot

`app/src/copilot/` is a deterministic assistant with no network calls.

| Module | Responsibility |
| --- | --- |
| `context.ts` | Store that screens publish structured results to (open strategy and backtest, Lab inputs/weights/optimization/projection, portfolio attribution, persona buys and sells loaded on the Personas screen); the panel passes only the active screen's entry |
| `assistant.ts` | `respond(message, context)`: guardrails, intent routing, and answer builders. A `Composer` formats every figure from engine fields and records it; `verifyFigures` then rejects any number in the text that is not in those records, vetted rule/glossary text or the user's message, and `hasUnsafeCertainty` rejects promise language |
| `guardrails.ts` | Classifies the user's message only (injection, action, certainty, advice); context text is never routed as an instruction. Draft strategies' free text is not quoted |
| `drafting.ts` | Pattern-based translation of a description into the strategy schema, with assumptions, unsupported parts, validation, edits to a copy of the strategy in context, a rule-field diff, and `variantFromText` ("on QQQ", "X instead of Y") which retargets a named or open strategy |
| `labChanges.ts` | `labChangeFromText`: reads the Lab inputs the Copilot may propose (ETF, or several to spread across as `alsoEtfs`, starting amount, monthly contribution, horizon) and validates them with `validateLab` |
| `glossary.ts` | Curated definitions and alias matching |

Permission levels are fixed in PRD 6.6.1. On the Personas screen, questions about loaded trades are answered from the published rows (`personaTrades`; issuer names are registered with `Composer.data`). Lab-input requests become a `labChange` proposal; the panel's `LabChangeCard` shows current and proposed values and calls `labStore.setInputs` only on Apply. The action guard no longer refuses "plan"/"inputs" wording because those requests become proposals; edits to portfolios, weights, assumptions, ledgers, transactions and snapshots are still refused. `personaRequest` routes "follow / track / what is X trading" to a persona answer; the panel's `PersonaCard` follows through `personaStore` only on click. User drafts' names are never quoted (`curatedName`).

The UI is `app/src/components/CopilotPanel.tsx`; drafts reuse `DraftEditor` and save through `strategyStore`. An LLM adapter could replace intent routing and phrasing while keeping the context store, Composer verification and confirmation flow.

## Change points

- To add a function, register it in `functions.ts`, create its screen in `app/src/functions/`, and wire it in `App.tsx`.
- To change a data call or its response type, edit `api.ts` and the screens that consume it.
- To change INTEL interpretation, edit `signals.ts` and check how `INTEL.tsx` composes the signals.
- To change service ports or setup, inspect `app/vite.config.ts` and the root shell scripts together.

## Verification

Run `npm test` from `app/` for unit coverage of the deterministic core (signal rules in `signals.ts`, the command parser in `functions.ts`, and the formatters in `format.ts`; tests live beside the source as `*.test.ts`, or `*.test.tsx` for DOM smoke tests under happy-dom, and run under Vitest). Run `npm run build` from `app/` for TypeScript and production build validation. For behavior that depends on providers, run the local services and check the affected screen with representative symbols and error cases.

GitHub Actions runs the same tests and frontend build on pushes and pull requests using Node.js 20 (`.github/workflows/frontend-build.yml`).

## Interactive Brokers (read-only)

`quant/ibkr.ts` normalizes the Client Portal Gateway's `/v1/api` responses: `gatewayState` (from `/iserver/auth/status`), `normalizeAccounts` (paper accounts are ids starting with D, such as DU1234567), `normalizePositions` (zero positions dropped; ticker from `ticker` or the first word of `contractDesc`) and `normalizeSummary` (net liquidation and cash). `trackable` keeps long USD `STK` positions with a price and lists the rest with a reason. `syncDrafts` compares a ledger's units with the broker's and returns sales for decreases (priced at the broker's price, or a supplied last close for a holding the broker no longer reports) followed by `transfer_in` entries for increases; a second sync with the same positions returns nothing. `lib/ibkr.ts` is the client: `assertReadOnly` allows only `GET /iserver/auth/status`, `POST /tickle`, `GET /portfolio/accounts`, `GET /portfolio/{id}/positions/{page}` and `GET /portfolio/{id}/summary`, and throws for anything else before a request is made (tested against order, reply, cancel and what-if paths). Requests time out after 8 seconds, because on macOS AirPlay Receiver holds port 5000 and hangs instead of refusing. Positions page 100 at a time. `functions/portfolio/BrokerPanel.tsx` polls the status (every 10 s until connected, then every 60 s), sends a keep-alive every 60 s while connected (the gateway drops idle sessions after about six minutes), and syncs only on a click. Broker-reported portfolios (`PortfolioMode` `broker`) are valued like manually reported ones. The UI was verified against a mock gateway returning the documented shapes; it has not been run against a real IBKR account.

