# StockHub — Phase 5 Plan: Trustworthy numbers, persona signals, and a build that runs anywhere

**Document:** Phase 5 plan and research notes
**Version:** 0.1 (proposed) · **Date:** 17 October 2026
**Status:** Proposed; the order and the decisions in [Section 6](#6-decisions-needed) need sign-off.
**Starting point:** Phase 4 ([PRD_phase4.md](PRD_phase4.md)), the look-back control, and the Copilot help fix of 17 October.

---

## 1. Where things stand and what is weak

Delivered through Phase 4: strategies on any ETF and across several, a Plan tab with jobs and sense checks, Lab with look-back and look-forward, personas from SEC filings (live to the minute), House trades, ARK daily trades, copy-trade backtests for House members, read-only IBKR, paper orders, an optional Claude wording layer, 400 automated tests.

Checked on 17 October, the weak spots that matter most:

| # | Weakness | Evidence |
| --- | --- | --- |
| 1 | **A plan's numbers assume a rebalance every day.** Sleeves are blended "as if their weights were restored daily". Real investors rebalance monthly or yearly, or never; daily rebalancing flatters diversified mixes. | `blendReturns` in `quant/portfolio.ts`; the note appears on the Allocation tab only. |
| 2 | **Short look-back windows understate strategies.** Indicators warm up *inside* the window, so a 3-year test of the 200-day filter spends its first 10 months in safety. | `runBacktestOn` slices the panel before `simulate`; flagged by a hint, not fixed. |
| 3 | **"Build me a plan" is judged on the data it was picked from.** It maximises growth inside the fall limit over the whole history. | `suggestPlan`; the out-of-sample check exists for the optimizer but not for the builder. |
| 4 | **Fund managers cannot be copy-tested.** Their 13F rows carry CUSIPs, not tickers. OpenFIGI maps CUSIP to ticker with no key (tested: Alphabet, Lennar, Tesla). | Phase 3 follow-ups. |
| 5 | **No way to know a persona's results.** The screen shows what they did, not how it turned out. | `PERS` shows trades only. |
| 6 | **New filings need you to be looking.** The 5-minute recheck only runs while the screen is open. | `refetchInterval` in `PERS`. |
| 7 | **Everything works only through the Vite dev server.** House, SEC, ARK, IBKR and LLM proxies are dev-server settings. `vite preview` has none of them, so a built copy cannot load personas, news or the broker. | `vite.config.ts` has `server.proxy` only. |
| 8 | **The UI has no committed end-to-end tests.** Every Phase 3 and 4 layout bug (clipped text, collapsing panel, overflowing bar, one-word-per-line header) was found by throwaway scripts. CI runs unit tests and the build only. | `.github/workflows/frontend-build.yml`. |
| 9 | **Two integrations were never run against the real thing.** IBKR (read-only sync and paper orders) and Claude phrasing were tested against mocks. | Phase 3 and 4 acceptance notes. |
| 10 | **The Copilot answered "Answer withheld" to any message it did not understand** (found while planning; fixed on 17 October, `0f9e5eb`). It suggests more such gaps exist at the edges of the rule-based router. | Regression test added. |

Not pursued: **Senate trades** (the eFD site returns 403 to automated requests on 17 October; it needs a paid or third-party feed), **live trading** (separate security and compliance decision), **Indian-listed instruments** (no validated data source).

## 2. Track A — Make a plan's numbers trustworthy

**A1. Rebalancing between strategies is a choice, not an assumption.** Let the user pick how the plan is rebalanced: never, annually, quarterly, monthly, or when a sleeve drifts 5 points (default quarterly). The plan's equity curve is built from each strategy's own equity curve (value, not return), with the chosen rule moving money between sleeves at the next close and costing the usual slippage. Report the daily-restored result next to it so the effect of the assumption is visible. The optimizer, Build me a plan, projection and Save Plan all use the chosen rule.

**A2. Warm-up from before the window.** Compute signals on the full history and begin trading at the window start, so a 3-year look-back tests the 200-day filter as it would have behaved, not with 10 months of dead time. Keep the warm-up flag only when history before the window does not exist.

**A3. Judge a built plan out of sample.** `suggestPlan` fits on the first 60% of history and reports how the same weights did on the rest next to equal-weight and the best single sleeve; the proposal says plainly when the later result is clearly worse. Add a walk-forward option to the weight search (fit on a growing window, test on the next year) and show the spread of the test results.

**Acceptance:** with one sleeve, results equal the single strategy for every rebalance rule; "never" equals buy-and-hold of the initial split; a test shows quarterly differs from daily-restored by a documented amount on the fixture; a 3-year window for the 200-day filter starts invested when 10 earlier months exist.

## 3. Track B — Persona signals you can act on and trust

**B1. Copy-test fund managers and insiders.** Map 13F CUSIPs to tickers with OpenFIGI (batched, cached by CUSIP, labelled), then reuse the copy-trade engine: a fund's new and added positions act on the 13F filing date; an insider's Form 4 buys act on the acceptance time. Same no-look-ahead test; same disclosure of lag cost.

**B2. Results since the trade.** For every persona's buys and sells, show the return of the stock from the day it became public to today, and the average and hit rate across their loaded trades, against SPY over the same days. This answers "was following them any good?" without a full backtest. Prices come from the existing history cache.

**B3. Alerts when the screen is closed.** Optional browser notifications and a tab-title count when a followed persona files while StockHub is open in any tab (poll on a lower frequency from a small background timer, with a per-persona mute). No server and no accounts; notifications only while a StockHub tab exists.

**Acceptance:** a CUSIP-to-ticker test with a recorded OpenFIGI response; copy results for Buffett's last two 13Fs with a look-ahead assertion; "since the trade" figures reproduce a hand calculation on a fixture; a notification fires once per new accession, never twice.

## 4. Track C — Prove it works and make it runnable anywhere

**C1. Committed end-to-end tests.** A Playwright smoke suite in `app/e2e/` that starts the dev server against recorded API fixtures (OpenBB, SEC, Clerk, ARK; a mock IBKR gateway and mock LLM endpoint) and checks each screen loads with no console errors, the Plan tab flow (add three strategies, see the redundancy issue, Build me a plan, apply), the Personas freshness line, the Copilot cards, the order flow against the mock gateway, and a layout assertion at 1440 px and 1024 px (no horizontal overflow, no element with zero width). Added to CI as a second job.

**C2. Proxies in `vite preview` and a documented run path.** Move the proxy table into a shared module used by both `server.proxy` and `preview.proxy`, so a built copy (`npm run build && npm run preview`) loads personas, news and the broker. Add `.env.example`, a single "configuration" section in the README (`STOCKHUB_SEC_CONTACT`, `IBKR_GATEWAY_URL`, `STOCKHUB_LLM_KEY`, `STOCKHUB_LLM_URL`), and a startup check that prints which optional features are on.

**C3. Real-account checks, guided.** A runbook and a one-command checker for the two integrations that only ran against mocks: `npm run check:ibkr` (status, accounts, positions, a what-if preview on a paper account; never submits) and `npm run check:llm` (a small fixed question set with known answers; reports figure-check pass rate and fallbacks). Output is pasteable into an issue. These need the user's paper login and key.

**C4. Copilot edges.** Add a small table-driven test of 60 realistic messages (questions, typos, numbers, mixed requests) asserting the answer kind and that nothing is ever withheld by a vetted-text mistake; fix what it finds. Add a check that every static string in answer builders passes its own figure check.

**Acceptance:** CI runs the smoke suite green on a clean checkout; `vite preview` serves personas with the contact set; both checkers run against the mocks in CI and print a clear report.

## 5. Order, effort and workflow

| Order | Item | Why this order | Size |
| --- | --- | --- | --- |
| 1 | C4 Copilot edges, A2 warm-up | Small, remove wrong or misleading output | S |
| 2 | A1 rebalancing, A3 out of sample | Core of "does the plan make sense" | M |
| 3 | C1 end-to-end tests | Protects everything after it | M |
| 4 | B2 results since the trade, B1 copy-test funds | Builds on live personas | M |
| 5 | C2 preview proxies and configuration | Makes the build runnable | S |
| 6 | B3 alerts | Depends on stable polling and tests | S |
| 7 | C3 real-account checks | Needs the user's paper login and API key | S, then user time |

**Workflow:** one GitHub issue per track (A, B, C), a branch per item, a pull request closing the issue, merged with a merge commit; small fixes go straight to `main`. No AI co-author lines.

## 6. Decisions needed

| # | Question | Recommendation |
| --- | --- | --- |
| 1 | Default rebalance rule for plans | Quarterly, with the daily-restored figure shown beside it. |
| 2 | Alerts: browser notifications only, or also email/push | Browser only; email or push needs a server and accounts, a different product decision. |
| 3 | Senate trades | Defer. Revisit with a paid or third-party feed if wanted. |
| 4 | Real-account checks | Run C3 yourself with a paper login before relying on the broker panel. |
| 5 | Hosting beyond your own machine | Not in Phase 5. C2 makes `vite preview` work; real hosting needs a server for the proxies and a decision on secrets. |

## 7. Delivery status

| Track | Status |
| --- | --- |
| A — Plan numbers | Delivered: A2 warm-up (#9), A1 rebalancing rules (#10), A3 out-of-sample check for Build me a plan (#11) |
| B — Persona signals | B2 results since the trade (#12) and B1 copy-testing funds and insiders (#13) delivered |
| C — Proof and runnability | C4 delivered in part: the help-list bug is fixed (`0f9e5eb`, issue #7) and `copilot/sweep.test.ts` runs about 80 realistic messages on nine screens and fails if any answer is withheld by mistake; the broader 60-message router table and the static-string check remain |
