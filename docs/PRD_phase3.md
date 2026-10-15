# StockHub — Phase 3 Plan: Combine, Follow, Connect

**Document:** Phase 3 plan and research notes
**Version:** 0.1 (draft for review) · **Date:** 16 October 2026
**Status:** Approved 16 October 2026 with the recommended defaults in [Section 6](#6-decisions-needed) (IBKR, House first, LLM optional). Progress is tracked in [Section 7](#7-delivery-status).
**Starting point:** Phase 2 as delivered ([PRD_phase2.md](PRD_phase2.md), Section 15), plus the Personas screen (`PERS`), core-ETF choice in the Lab and the Copilot permission levels (6.6.1).

---

## 1. Summary

Phase 2 made strategies testable on any ETF and let the user follow public investors. Phase 3 has three tracks, in this order:

1. **Combine.** Run one strategy across several ETFs as a single sleeve (for example the golden cross on SPY, QQQ and DIA), and see whether spreading it helps.
2. **Follow.** Add US House members' stock trades from the Clerk's free, official filings, and let the user backtest copying any persona's trades with honest filing delays.
3. **Connect.** Link an Interactive Brokers account: first read-only (positions next to the plan), then paper-trading orders under the 6.6.1 rules. Live trading stays out of Phase 3.

An optional fourth track replaces the Copilot's rule-based language layer with an LLM while keeping the same grounding and permission rules.

The product stays a local, single-user tool. Every new external source goes through the Vite dev-server proxy, which the app already uses for RSS feeds. That keeps secrets and cross-origin calls out of the browser bundle.

---

## 2. Research findings

### 2.1 Congressional trades (House): feasible, free, keyless

Verified on 16 October 2026 by downloading the files:

- `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2026FD.zip` (about 64 KB) holds `2026FD.xml`. It indexes every filing for the year, giving the member's name, state and district, filing type, filing date and `DocID`.
  - `FilingType` `P` is a Periodic Transaction Report (PTR); 2026 has 427 so far. Nancy Pelosi has three 2026 PTRs (filed 23 January, 23 June and 21 August).
- Each PTR is a PDF at `public_disc/ptr-pdfs/<year>/<DocID>.pdf`.
  - Electronically filed PTRs, with `DocID` starting `2…`, contain extractable text: asset, ticker, transaction type, date and amount band.
  - Paper filings are scanned images. The app links to these instead of parsing them.
- The Clerk sends no CORS headers, so the browser cannot fetch these files directly. They go through a new `/clerk` Vite proxy entry, the same pattern as `/rss/yahoo`.
- **Data limits to disclose:**
  - Amounts are ranges ($1,001–$15,000 and so on), not exact values.
  - Filings may arrive up to 45 days after the trade.
  - Spouse and dependent trades appear with an owner code.
- **Legal:** 5 U.S.C. §13107 (formerly app. §105(c)) bars obtaining these reports for unlawful or commercial purposes (news media excepted). A personal, non-commercial research tool fits. Publishing the product commercially would need legal review first.

### 2.2 Congressional trades (Senate): feasible later

The Senate's eFD site requires accepting a click-through agreement in a session before searching. Its PTRs are HTML forms, which are easier to parse than House PDFs. Scrapers exist (`capitolgains`, Apify actors), but all are unofficial. The plan defers the Senate to after the House works, because it needs a cookie and CSRF session handled server-side.

### 2.3 Other politicians

The President and executive officials file OGE 278e annual reports and 278-T transaction reports as PDFs on OGE's site. These are less regular, so they stay unavailable, as they are today. The Stock Watcher S3 buckets still return 403, and FMP/Quiver need paid keys. The Clerk is the only free source that is both reliable and official.

### 2.4 Interactive Brokers

- **Retail access** goes through the **Client Portal Gateway**, a small local Java program. The user logs in once in the browser with 2FA, and the app then calls its REST endpoints.
  - A session lasts at most 24 hours and resets at midnight (New York, Zug or Hong Kong time).
  - It drops after about 6 minutes without a request, so call `/tickle` about once a minute.
  - `/iserver/auth/status` plus `/iserver/auth/ssodh/init` recover a lapsed session.
  - Paper accounts are supported, through a separate paper login.
- **OAuth** (the newer "Web API") uses `private_key_jwt` and is aimed at institutional and registered third parties. No source confirmed that individuals can use it, so the plan uses the Gateway.
- **CORS:** the Gateway serves HTTPS on localhost with a self-signed certificate, and no source confirmed browser CORS support. The plan proxies it through Vite (`/ibkr` → `https://localhost:5000`, `secure: false`), which also keeps the session cookie same-origin.
- **Alternative: Alpaca.** It offers free paper accounts from an email signup, an API-key REST interface and fractional dollar-sized ETF orders (market orders only, regular hours). Alpaca is simpler to integrate, and IBKR is what the owner asked for. Section 6 lists this as a decision.

### 2.5 LLM Copilot (optional)

The repository holds no model credentials (Phase 2 decision 7). A local adapter could:

- read an API key from an environment variable that the Vite proxy injects as a header, so the key never enters the bundle;
- send the existing screen context and engine results as tool outputs;
- pass every reply through the existing figure verifier and guardrails.

The rule-based Copilot stays as the fallback when no key is set.

---

## 3. Scope and milestones

### Milestone E0: Phase 2 hardening (small, first)

- Check every Phase 2 screen in the browser: STRAT ETF mapper, LAB "Run on ETF", PERS, and the Copilot Apply-to-Lab and persona summaries. So far these have only been covered by unit tests.
- Fix the layout and empty-state problems this finds.
- Run the live tests (`LIVE=1`) against every persona source, and add a staleness warning when the newest filing is more than 120 days old (Burry, for example).

*Exit:* each screen is checked by hand with notes in the PR, and the live tests pass.

### Milestone E1: Strategy across ETFs (Combine)

- **Schema.** Add a new DSL field `targets: [{ ticker, weight }]` (schema 2, with schema 1 still accepted).
  - The engine runs the strategy once per target through `applyTarget`, then combines the sleeves with a fixed weight and the strategy's own rebalance cadence.
  - The engine treats the result as one strategy, so it takes one basket slot.
- **Report.** Show each ETF's contribution, the correlation between the ETF sleeves, and the combined result against the single-ETF version and against equal-weight buy-and-hold of the same ETFs.
- **UI.**
  - STRAT: a "Run on several ETFs" multi-select, with CORE_ETFS first.
  - LAB: the ETF picker becomes multi-select for basket strategies that trade a single risky ETF.
- **Copilot (level 1).** Requests like "run the golden cross on SPY, QQQ and DIA" create a draft variant through `variantFromText`, extended to accept lists.
- **Tests.** One target gives exactly the single-ETF result. Weights must sum to 1. The time window is the overlapping period of all targets, and that window is disclosed.

*Exit:* a combined run is reproducible, and the report says whether spreading reduced the maximum drawdown compared with the best single ETF.

### Milestone E2: House members as personas (Follow)

- Add `/clerk` to the Vite proxy (plus the matching production note in the README).
- **New `quant/congress.ts`:**
  - parse the yearly XML index;
  - fetch a member's PTRs, with the current and previous year by default;
  - extract text with `pdfjs-dist` (a new dependency, run in a web worker);
  - parse the transaction table into `{ owner, asset, ticker?, type: buy|sell|exchange, date, notified, amountBand }`.
- Rows without a ticker (bonds, Treasury bills, private funds) are kept and labelled. Scanned filings are listed as "not machine-readable" with a link.
- **PERS:** a "Members of Congress" group with search by name or district, and Pelosi as a seed persona. Show the ranges as ranges, never as midpoints dressed up as exact numbers.
- **Copilot:** the existing POLITICIAN_NOTE changes from "unavailable" to "House members available; Senate and executive branch not yet". The `personaTrades` answer covers PTRs.
- **Caching:** store the index and parsed PTRs in browser storage by `DocID`. A filed PTR never changes, and amendments get a new `DocID`.

*Exit:* Pelosi's three 2026 PTRs parse with correct dates, tickers and bands. A parser golden test uses a saved fixture PDF.

### Milestone E3: Copy-trade backtest (Follow)

- Turn a persona into a strategy. Its holdings become investable on the date the public could first see them:
  - a 13F on its **filing date**, not the quarter end;
  - a PTR on its **notification date**;
  - an insider Form 4 on its filing date.
- Fills happen on the next close, as with every other strategy.
- **Weights:**
  - 13F: by reported value, renormalised over the tickers the app has prices for.
  - PTR: equal-weight over open buys, because amounts are bands.
  - The coverage the app has prices for is disclosed.
- Compare against SPY and against an "instant knowledge" version that trades on the transaction date. The gap between the two is the cost of the reporting lag, which is the honest answer to "should I copy Pelosi?".
- The Lab can use a persona strategy as one of the three basket slots.

*Exit:* no look-ahead (a test asserts that no position starts before its filing date), and the price coverage and lag effect appear in the report.

### Milestone E4: IBKR read-only (Connect)

- **Proxy.** Add `/ibkr` to the Vite proxy. A Connect panel in PORT shows the Gateway status: not running, needs login (with a link to open the Gateway login page), or connected (paper or live).
  - A tickle every 60 seconds runs only while the panel is open.
- **Read** `/portfolio/accounts`, `/portfolio/{id}/positions/0` and `/portfolio/{id}/summary`. The read-only status is stated in the UI.
- **My Portfolio** gets a third kind, **broker-reported**, alongside paper and manually reported:
  - snapshots are timestamped and never edited;
  - the plan-versus-actual view works against it.
- **Credentials.** No credentials are stored. The session lives in the Gateway, and the app keeps only the account id and the snapshots.
- **Copilot (level 0)** can read and explain broker positions on PORT and cannot do anything else.

*Exit:* a paper account's positions match the IBKR web portal, and disconnecting leaves the saved snapshots intact.

### Milestone E5: Paper orders (Connect)

This implements the future trading rules in 6.6.1 for **paper accounts only**:

- **Order screen (ORD).** A separate screen that proposes rebalance orders from a saved plan's target weights against broker positions.
  - Each order is previewed with IBKR's what-if preview (`/iserver/account/{id}/orders/whatif`), showing commission and margin impact.
  - Each order needs its own confirmation click. IBKR's follow-up "reply" prompts go to the user verbatim, and the app never auto-confirms them.
- **Hard limits, enforced in code outside the Copilot:**
  - paper account ids only (live ids are rejected);
  - an ETF allow-list (the instrument universe);
  - long-only market or limit orders, with no shorts, options or margin;
  - a per-order and per-day notional cap;
  - a kill switch that cancels open orders and disables the screen.
- An append-only audit log records every proposal, confirmation, submission and broker response.
- **Copilot (level 1)** may open ORD with a proposed rebalance. It never submits an order (level 3 stays "never").

*Exit:* a full rebalance runs on paper end to end, each limit is rejected by a unit test, and the audit log is exportable.

**Live trading** is not in Phase 3. It needs a separate decision covering a security review, an account-type check and legal and compliance review (Phase 2 non-goals).

### Milestone E6 (optional): LLM Copilot adapter

- **Adapter.** An `LLMAdapter` interface with one Claude implementation (latest Claude model) that the Copilot calls only when `STOCKHUB_LLM_KEY` is set on the dev server. Without it, the rule-based Copilot runs as today.
- **Tools** match today's capabilities exactly: read context, explain, draft strategy, propose Lab change, follow persona and open screen. No new permission is granted by the model.
- **Checks.** The figure verifier and the injection, advice and certainty guardrails run on every LLM reply. A failing reply is withheld, as now.
- **Evaluation.** A fixed set of questions with known engine outputs (the AC-09 factuality metric) must pass before the adapter is turned on by default.

---

## 4. Acceptance criteria

| ID | Criterion |
| --- | --- |
| P3-01 | A strategy run on N ETFs reproduces the single-ETF result when N = 1 and discloses the common date window. |
| P3-02 | Combined-ETF reports show per-ETF contribution, sleeve correlation and the equal-weight buy-and-hold comparison. |
| P3-03 | House PTRs are shown with amount ranges and both the transaction and notification dates. Scanned filings are labelled, not guessed. |
| P3-04 | Copy-trade backtests never hold a position before its public filing date, and they report price coverage and the reporting-lag cost. |
| P3-05 | No broker credential, token or API key is stored in the browser, the repository or the docs. |
| P3-06 | Broker-reported holdings are kept separate from paper and manually reported holdings, and their snapshots are immutable. |
| P3-07 | No order reaches IBKR without a per-order click. Live account ids, non-allow-listed instruments, shorts, options, margin and over-cap orders are rejected in code. |
| P3-08 | The Copilot's permission levels are unchanged by every Phase 3 feature, including the LLM adapter. |
| P3-09 | Every new source has a provenance line (source, retrieval time, staleness) on screen. |

---

## 5. Risks

| Risk | Mitigation |
| --- | --- |
| PTR PDF layouts vary or change | Parse only e-filed reports, use golden fixtures per layout, show unparsed rows instead of guessing |
| Users read copy-trade backtests as advice | Disclose the lag cost, use a "historical, not a recommendation" label, apply the advice guardrail |
| Gateway sessions expire mid-use | Status polling, clear "log in again" state, no queued orders across sessions |
| Order bugs with real money | Paper-only in Phase 3, hard limits in code, audit log, kill switch |
| Vite proxy is dev-only | Document it, and add a small production proxy or a packaged start script before any non-local deployment |
| New dependency weight (`pdfjs-dist`) | Load it lazily in a worker, only on PERS |

---

## 6. Decisions needed

| # | Question | Recommendation |
| --- | --- | --- |
| 1 | Milestone order | E0 → E1 → E2 → E3 → E4 → E5, with E6 whenever a key is available. Combine first because it is pure engine work on code that already exists. |
| 2 | Broker for paper trading | **IBKR**, as asked. Alpaca is simpler and could be a second adapter later. |
| 3 | Senate PTRs in Phase 3? | No. Do the House first, then the Senate as a follow-up once the eFD session handling is proven. |
| 4 | LLM Copilot | Optional. Build it only if you want to supply an API key; the rule-based Copilot keeps working without one. |
| 5 | Live trading | Out of Phase 3 by design; to be decided after paper trading has run cleanly. |

---

## 7. Delivery status

| Milestone | Status |
| --- | --- |
| E0 — Phase 2 hardening | Delivered. A headless-Chrome pass over STRAT, LAB, PERS, PORT and the Copilot found and fixed: one failed ticker blocking every strategy (an empty provider answer was cached), clipped card summaries, cramped card footers, a stale PERS description, and unlabelled 13F share classes. Apply to Lab and persona summaries work end to end. |
| E1 — Strategy across ETFs | Delivered: `spread` definitions, sleeve engine and report (per-ETF results, correlation, single-ETF and buy-and-hold baselines, drawdown verdict); STRAT *Spread across several ETFs*; Lab *Spread across more ETFs*; Copilot spread drafts and Lab spread proposals. Checked in the browser on live data. |
| E2 — House members as personas | Delivered: Clerk index and PTR parser with a golden fixture, `/clerk` proxy, five presets and member search, amount ranges, scanned reports linked, Copilot follow and summaries. Checked in the browser on live data (Pelosi: 7 reports, 39 trades). |
| E3 — Copy-trade backtest | Delivered for House members: `schedule` rule type, copy-trade engine (filing-date and trade-date versions, lag cost, coverage) with a no-look-ahead test, *Backtest copying* panel, Copilot explanation. Checked live (Pelosi, Dec 2024 to Oct 2026: filing-date copy +42.6%, trade-date copy +58.6%, SPY +32.3%, delay cost $1,598 on $10,000). Deferred: funds (13F rows have CUSIPs, not tickers; needs a CUSIP-to-ticker source), insiders (single-stock, little to learn), and using a copy as a Lab slot (under two years of history is below the 60-month projection minimum). |
| E4 — IBKR read-only | In progress: `/ibkr` gateway proxy, read-only client (allow-list, tested to block order paths), position and summary normalizers, ledger sync |
| E5 — Paper orders | Not started |
| E6 — LLM Copilot adapter | Not started |

---

## Sources

- House Clerk financial disclosures: [disclosures-clerk.house.gov](https://disclosures-clerk.house.gov/FinancialDisclosure/ViewReport). Yearly index and PTR PDFs were checked directly on 16 October 2026.
- Senate eFD notes: [Disclosed Capitol glossary](https://www.disclosedcapitol.com/glossary/senate-efd), [capitolgains on PyPI](https://pypi.org/project/capitolgains/).
- IBKR: [Trading Web API](https://www.interactivebrokers.com/campus/ibkr-api-page/web-api-trading/), [Authentication FAQ](https://www.interactivebrokers.com/docs/web-api/authentication/faq), [Launching and authenticating the Gateway](https://www.interactivebrokers.com/campus/trading-lessons/launching-and-authenticating-the-gateway/).
- Alpaca: [Trading API](https://docs.alpaca.markets/docs/trading-api), [Fractional trading](https://alpaca.markets/blog/fractional-trading/).
