# StockHub — Product Requirements Document (Phase 2)

**Product:** StockHub (`stockhub-cli`). The PRD's working name "EMBER" was dropped; the product keeps the StockHub name.
**Document:** PRD — Phase 2: Strategy-Driven Investment Terminal
**Version:** 1.0 · **Date:** 15 October 2026
**Status:** Approved for implementation; implementation status is tracked in [Section 15](#15-implementation-status-and-recorded-decisions).
**Starting point:** The Phase 1 terminal described in [PRD.md](PRD.md).

---

## 1. Executive Summary

Phase 2 transforms the current market-data exploration terminal into a personal investment strategy terminal. Users will be able to discover explainable, rules-based investing strategies; compare their historical results and risks; combine selected strategies into a personalized plan; simulate a range of potential future outcomes; and monitor hypothetical or actual investments against their original projections.

The product is not an AI bot that promises profits or automatically executes trades. Calculations, strategy execution, backtesting, portfolio optimization, and projections must be handled by deterministic, auditable quantitative services. AI is used to explain concepts and results, help users express preferences, and translate natural-language strategy ideas into structured rules for review.

**Proposed positioning**

> Discover quantitative investment strategies. Understand the rules. Test the evidence. Simulate your money. Track your plan against reality.

**Primary audience.** Early-career, self-directed investors who primarily invest in ETFs and index funds, including the S&P 500 and, where reliable data and instruments are supported, Indian benchmarks such as Nifty 50. The product should also support more advanced users experimenting with systematic entry/exit and seasonal strategies.

**Differentiation hypothesis.** Existing tools often specialize in market terminals, backtesting, quantitative strategy creation, portfolio analysis, or learning. StockHub's hypothesis is that a cohesive, intuitive workspace connecting strategy discovery → credible backtesting → multi-strategy allocation → probabilistic planning → projection-versus-reality tracking, with contextual explanations, can serve an underserved beginner-to-intermediate audience. This is a hypothesis to validate, not a claim of market uniqueness.

---

## 2. Current State and Phase Boundary

**Existing baseline (Phase 1)** — verified against the repository:

- Terminal-style interface: command bar, quick bar, workspace tabs, status bar (`app/src/App.tsx`).
- 18 registered functions (`app/src/lib/functions.ts`): Command Center, INTEL scorecard, profile, chart, quote, historical prices, financials, ratios, dividends, analyst estimates, news, options, world indices, movers, crypto, FX, US yield curve, help.
- Data through the OpenBB Platform (4.x) over the local `/api/v1` proxy, with Yahoo Finance as the main provider; company news from public RSS feeds.
- Rule-based INTEL signals (`app/src/lib/signals.ts`), Vitest unit tests, and a GitHub Actions build.
- No AI assistant, strategy catalog, strategy engine, portfolio optimizer, projection system, or user portfolio storage existed before Phase 2.
- No accounts or server-side persistence: the app is a local, single-user tool and persists UI state in browser storage.

**Phase 2 adds**

1. **Explore:** retain and enhance the current terminal as the market-data foundation.
2. **Strategies:** curated strategy discovery and comparison; select strategies for a basket.
3. **Simulation Lab:** strategy backtests, constrained allocation optimization, forward scenario projections, and explanations.
4. **My Portfolio:** hypothetical portfolios, manually recorded actual investments, plan tracking, and projection snapshots.
5. **Contextual AI Copilot:** available alongside the primary screens, grounded in verified platform data and computation results.

Phase 2 must extend rather than unnecessarily replace the working terminal.

---

## 3. Goals, Non-Goals, and Principles

**Product goals**

- Make systematic investment strategies understandable and testable without requiring coding skills.
- Let a user start with a small capital amount (e.g., USD 200), set recurring contributions, choose a horizon, and inspect an evidence-based range of possible outcomes.
- Support selection and combination of up to three strategies in the initial UX, with transparent allocation constraints.
- Demonstrate whether combined strategies meaningfully diversify risk versus a baseline ETF buy-and-hold portfolio.
- Make all backtest/projection inputs, methods, assumptions, costs, and uncertainty visible.
- Let users save plans and review differences between historical forecasts and observed outcomes over time.
- Build a technically compelling, reproducible open-source portfolio project.

**Non-goals for MVP**

- Guaranteed investment returns or claims of risk-free profits.
- Automatic trade execution, broker account connectivity, order routing, or copy-trading of live brokerage accounts.
- A social network, payments, strategy subscriptions, or monetized creator marketplace.
- Options, margin, leverage, derivatives, intraday/high-frequency trading, or tax advice.
- AI-generated numeric forecasts without a validated quant engine.
- Personalized regulated investment advice; legal/compliance review is required before expanding beyond informational research and user-directed simulations.

**Design principles**

- **Math over hype:** all computed metrics come from verifiable code and data.
- **Evidence over returns:** surface statistical robustness and risk, not only headline performance.
- **Education in context:** explain unfamiliar terms precisely where users encounter them.
- **Separation of concerns:** financial data, quant engine, AI layer, and UI are independently testable.
- **Honest uncertainty:** display scenarios and confidence/percentile semantics; never imply a forecast is certain.
- **Beginner-first, advanced-capable:** simple defaults with accessible methodology and deeper controls.

---

## 4. Information Architecture

Primary navigation:

| Screen | Job to be done | MVP scope |
| --- | --- | --- |
| **Explore** | Research instruments and markets | Existing terminal, search, charts, price history, linked strategy discovery |
| **Strategies** | Discover and select evidence-backed investing rules | Curated cards, methodology pages, risk/performance scorecards, comparison, add-to-basket |
| **Simulation Lab** | Test strategies and model investment plans | Initial capital, contributions, horizon, backtests, benchmark comparisons, optimization, projection bands, scenario inspection |
| **My Portfolio** | Save and evaluate investment plans over time | Paper portfolio, manually entered real holdings, transactions, contribution records, immutable projection snapshots, actual-versus-plan review |

Persistent AI side panel: contextual assistance accessible from all four screens; not a fifth primary screen.

**Main user journey:** Explore an ETF → inspect a related strategy → compare strategies → add up to three to basket → enter starting money and monthly investment → choose risk objective → run backtest/optimization/projection → inspect assumptions and lower/median/upper outcomes → save paper or tracked plan → revisit to compare observations against initial projection.

---

## 5. Personas and Key User Stories

**P1 — New long-term ETF investor:** has USD 200–1,000 to start, contributes monthly, wants to understand realistic outcomes and avoid trading hype.

**P2 — Curious systematic investor:** wants to test rules such as a 200-day moving average, drawdown-triggered contributions, and calendar seasonality, including S&P 500 or Nifty exposures where supported.

**P3 — Existing DIY investor:** already holds ETFs and wants to record holdings, compare with a plan, and see whether their earlier projection is tracking plausibly.

**Critical stories**

- As a user, I can inspect the exact entry, exit, contribution, and rebalance rules of any strategy before selecting it.
- As a user, I can see historical backtests net of modeled fees, compared with an appropriate benchmark.
- As a user, I can select three strategies and find out whether they overlap in underlying exposure.
- As a user, I can provide USD 200, a recurring contribution amount, and a five-year horizon to inspect an uncertainty range, not a guaranteed target.
- As a user, I can adjust my tolerance for drawdowns and see how allocation proposals change.
- As a user, I can ask the AI to explain Sharpe ratio, maximum drawdown, why an allocation was suggested, or why a backtest may be unreliable.
- As a user, I can save a plan and later distinguish its original assumptions from updated simulations and realized performance.

---

## 6. Feature Requirements

### 6.1 Explore — retain and connect the market terminal

- **EXP-01** Preserve all functioning Phase 1 exploration screens and provider integrations.
- **EXP-02** Show whether instrument data supports dividend-adjusted performance, splits/corporate actions, volume, and available history.
- **EXP-03** From an instrument, surface applicable strategies and an action to open the Simulation Lab with that instrument or benchmark selected.
- **EXP-04** Clearly distinguish an index level from an investable ETF/proxy; note currency, exchange and time-zone limitations.
- **EXP-05** Gracefully show missing data rather than substituting unverified values.

### 6.2 Strategies — curated strategy marketplace

- **STR-01** Display a searchable/filterable catalog of curated strategy recipes.
- **STR-02** Each strategy page must provide:
  - Name, summary, intended use, instruments/universe, region, typical holding period.
  - Exact rule definition and parameters; version and methodology reference.
  - Applicable data set and observation period.
  - Performance against specified benchmark with dates.
  - Risk metrics, costs, trade count, sample size, and testing methodology.
  - Warnings about overfitting, concentration, regime dependence, and untested assumptions.
  - Explicit evidence status: *Backtested*, *Paper-tracked*, or *Verified live* (the latter only if verifiable; not planned for MVP).
- **STR-03** Allow selection of up to three strategies in an editable basket.
- **STR-04** Compare selected strategies on common dates, return basis, fees, currency, frequency and benchmarks when feasible.
- **STR-05** Copy/fork a curated recipe into a user-owned draft; expose parameters without changing original published version.
- **STR-06** Users may save their own strategy drafts locally/account-side; public creator submissions are out of MVP scope.
- **STR-07** Rankings must not rely on total return alone; include evidence and risk indicators.

**Seed strategy catalog (initial target: 8–12)**

- Fixed-schedule dollar-cost averaging (DCA).
- Buy and hold (benchmark baseline).
- 200-day moving average exposure filter.
- Monthly or quarterly allocation rebalancing.
- Percentage-threshold rebalancing.
- Drawdown-triggered additional contributions, subject to available cash.
- Momentum rotation among a predefined set of diversified ETFs.
- Simple volatility-targeted allocation with leverage prohibited in MVP.
- Calendar/seasonal index exposure rule clearly marked research/experimental, subject to adequate observations and robust out-of-sample testing.
- Cash-buffer or bond/cash allocation regime.

Nifty-specific strategies require validated instrument and corporate-action/currency data before publication.

### 6.3 Quantitative Backtesting Engine

- **QNT-01** Strategies are represented by a versioned structured definition (JSON/DSL) with instrument universe, conditions, sizing rules, cash handling, rebalance schedule, fee model, and execution conventions.
- **QNT-02** Backtests execute deterministically against dated, provenance-tracked data.
- **QNT-03** Enforce no look-ahead: indicators may only use data available at the decision point; orders fill at an explicitly modeled subsequent tradable price.
- **QNT-04** Support cash drag, fractional share assumptions or whole-share constraints, contributions, dividends, fees/slippage, splits, and currency conversions only where reliable data is available.
- **QNT-05** Display CAGR/annualized return, total return, max drawdown, realized volatility, Sharpe ratio (risk-free-rate assumption documented), downside measure such as Sortino, turnover, trade count, and benchmark excess performance. Metrics inappropriate to the sample must be marked unavailable.
- **QNT-06** Evaluate robustness with chronological train/test separation, rolling out-of-sample windows and sensitivity tests on key strategy parameters where feasible.
- **QNT-07** Display common start/end dates, a data-quality flag, and limitations for every comparison.
- **QNT-08** Backtest outputs must be reproducible with input/data/strategy version identifiers.

### 6.4 Simulation Lab — capital, optimization, and projections

- **SIM-01** Inputs: initial capital; optional existing holdings; recurring contribution amount and frequency; investment horizon (MVP 1–30 years); currency; selected strategies (1–3); allocation constraints; and a risk objective.
- **SIM-02** Investment objectives include at least lower volatility, balanced risk, and growth-oriented modes, with quantified trade-offs rather than a single supposedly best strategy.
- **SIM-03** Evaluate underlying position overlap; combining three S&P 500-derived strategies must not automatically be presented as diversification.
- **SIM-04** The quantitative optimizer proposes weights according to a documented objective and constraints (e.g., long-only, no leverage, weights sum to 100%, caps on single strategy/instrument exposure).
- **SIM-05** Display allocation proposals alongside equal-weight and relevant buy-and-hold baselines. Users must be free to override weights.
- **SIM-06** Generate simulated terminal wealth distributions using a methodology appropriate to the sample, initially historical resampling/block bootstrap, with sensitivity scenarios; consider Monte Carlo with explicit parameter assumptions as a second method.
- **SIM-07** Display lower / median / upper percentiles, provisionally 10th / 50th / 90th, with a fan chart and cash-contribution line. The lower percentile is not an absolute worst case; the upper is not a maximum possible gain.
- **SIM-08** Show an estimated range of ending balances, total contributed, projected return/gain or loss, inflation-adjusted values where assumptions are available, and probability of loss/goal attainment only when methodologically defensible.
- **SIM-09** Allow assumptions and time periods to be modified and rerun without overwriting previous saved projections.
- **SIM-10** Make available a transparent calculation report: data window, sampling method, simulation count, random seed, strategy versions, fees, tax exclusion, inflation, and uncertainty warnings.
- **SIM-11** For very short histories or inadequate data, suppress unsupported precision and flag projection quality instead of manufacturing a forecast.
- **SIM-12** Default to informational simulations and user-directed choices; AI may suggest trade-offs but must not assert guaranteed outcomes.

**Example simulation.** A user selects three strategies, specifies USD 200 initial investment, USD 50 monthly contributions, five years, and a balanced risk preference. The system validates data, backtests each strategy on comparable periods, proposes constrained weights, simulates feasible return paths, and displays a percentile range of hypothetical ending balances. No numerical result is specified in this PRD because it must be computed using actual strategy returns and explicitly chosen assumptions.

### 6.5 My Portfolio — paper and manually tracked actual investments

- **POR-01** Create and name paper portfolios from a saved simulation.
- **POR-02** Record investment contributions, transactions, fees, holdings and cash balance for paper accounts; support paper performance from tracked data.
- **POR-03** Allow users to manually enter actual holdings and transactions; always label these manually reported, not broker-verified.
- **POR-04** Persist an immutable projection snapshot at plan creation including dates, allocations, inputs, assumptions, model version and projected percentile bands.
- **POR-05** Show a time-aligned comparison of: original projected range, current portfolio valuation, contributions, and latest projection.
- **POR-06** Clearly separate projection error from contribution differences, allocation changes, FX movement and market returns.
- **POR-07** Support re-running projections on current data while preserving previous snapshots.
- **POR-08** Display a five-year forecast view and selectable alternative horizons, with prominent warnings about uncertainty.
- **POR-09** No brokerage API or live order execution in MVP.

### 6.6 Contextual AI Copilot

- **AI-01** Persistent, collapsible chat panel with access to the current permitted screen context, strategy metadata, financial term glossary, and structured engine outputs.
- **AI-02** Explain concepts such as DCA, CAGR, ETF, Nifty, moving average, Sharpe, drawdown, correlation, confidence interval and percentile outcomes in accessible language.
- **AI-03** Explain the exact rule set and rationale of a selected strategy; identify risk, caveats and evidence limitations.
- **AI-04** Help translate a natural-language strategy idea into proposed structured DSL/JSON; show an editable diff/preview and require explicit user confirmation before simulation.
- **AI-05** Explain optimization output from machine-readable results, including why weights changed and what constraints bound the solution.
- **AI-06** AI must never invent data, strategies' returns, numerical portfolio values, or backtest results. Financial calculations are run by the quant engine.
- **AI-07** Reference available platform source data/methodology in responses and identify unavailable evidence.
- **AI-08** Do not place orders, modify a portfolio, publish strategies, or alter financial assumptions without a clear user action/confirmation.
- **AI-09** Implement guardrails against unsafe financial certainty and prompt injection from strategy descriptions or external content.

---

## 7. Proposed Screen Experience

**Screen 1: Explore.** Retain terminal-style search, market chart, quote panes and keyboard-forward navigation. Add lightweight links: View applicable strategies, Compare, Simulate. Avoid redesigning the functional terminal shell.

**Screen 2: Strategies**

- Left rail: tags and filters (ETF, index, trend, seasonal, DCA, risk, horizon, evidence quality).
- Main grid/list: strategy cards with short description, evidence status, benchmark-relative return, max drawdown, sample period and methodology badge.
- Detail drawer: exact strategy rules, explainable flow diagram, metrics, trade timeline, data caveats, version.
- Persistent basket: up to three saved selections; Compare and Open in Lab actions.

**Screen 3: Simulation Lab**

- Left pane: existing capital, holdings, monthly contribution, duration, strategy basket, objective and weight constraints.
- Main canvas: historical backtest chart; optimizer allocation bars; lower/median/upper projection fan chart; contribution baseline; risk and robustness metrics.
- Right AI pane: explanatory prompts and answers with references to quant outputs.
- Actions: Run Backtest, Optimize Allocation, Run Projection, Save Plan, View Methodology.
- Results distinguish historical backtest, future simulation, and live/paper observation with visible labels.

**Screen 4: My Portfolio**

- Overview of saved paper plans and actual holdings.
- Value and contribution ledger with filters.
- Original Plan vs Observed vs Reforecast timeline.
- Strategy exposure and deviations; snapshots and explanations.
- A portfolio may exist without any real-money integration.

---

## 8. Technical Architecture

```text
Existing market-data providers
        |
        v
Data adapter + quality/provenance layer
        |
        +--> normalized historical price/dividend/FX datasets
        |                 |
        |                 v
        |         Deterministic quant services
        |         - strategy DSL evaluator
        |         - event-driven backtester
        |         - metric + benchmark engine
        |         - optimizer
        |         - scenario/Monte Carlo simulator
        |                 |
        |                 v
        |         Versioned result artifacts
        |                 |
        +-----------------+-------------->
                          API/application service
                          |               |
                          v               v
                    Terminal UI      Contextual AI service
                    (4 screens)     (explanations / DSL drafts)
                          |
                          v
                   User database
            (strategies, baskets, plans,
             transactions, projection snapshots)
```

**Implementation guidelines**

- Audit the current repo before choosing languages or restructuring. Reuse the existing front-end shell, API adapter, charting stack, and command infrastructure when practical.
- Prefer an isolated quantitative calculation service/library with strictly defined inputs/outputs and deterministic test fixtures. Python with established numerical packages is one viable option, but follow actual codebase constraints.
- Cache normalized historical market data with explicit dataset versions and timestamps. Provide provider adapters so data changes do not silently alter historical tests.
- Use idempotent job IDs for backtests and simulations; return status, errors, method metadata and result IDs.
- Long-running optimization/simulation runs should use background application worker processes, queues, cancellation and progress states; no dependence on LLM arithmetic.
- Version user-defined strategy schemas and snapshots; a result must remain interpretable after code evolves.
- Persist only required personal financial details; avoid storing broker credentials in MVP.

**Illustrative data entities**

| Entity | Key fields |
| --- | --- |
| `Instrument` | id, ticker, exchange, currency, instrument_type, provider_mapping |
| `DataSetVersion` | id, provider, window, adjusted_price_basis, update_time, quality_flags |
| `Strategy` | id, creator, version, status, DSL, supported_universe, risk_flags |
| `BacktestRun` | id, strategy_version, dataset_version, inputs, results, trade_log, timestamp |
| `StrategyBasket` | id, user_id, strategy_ids, user_weights, constraints |
| `OptimizationRun` | id, basket_id, objective, method, constraints, weights, diagnostics |
| `SimulationRun` | id, basket_id, optimization_id, assumptions, seed, methodology, percentiles |
| `Portfolio` | id, user_id, mode (paper/manual_actual), base_currency |
| `Transaction` | id, portfolio_id, instrument_id, date, side, units, price, fee |
| `ProjectionSnapshot` | id, portfolio_id, simulation_id, original_inputs, distribution, created_at |

**API contract candidates**

- `GET /strategies`, `GET /strategies/{id}`
- `POST /strategies/validate`, `POST /strategies/drafts`
- `POST /backtests`, `GET /backtests/{runId}`
- `POST /optimizations`, `GET /optimizations/{runId}`
- `POST /simulations`, `GET /simulations/{runId}`
- `POST /portfolios`, `GET /portfolios/{id}`, `POST /portfolios/{id}/transactions`
- `POST /portfolios/{id}/snapshots`, `GET /portfolios/{id}/comparison`
- `POST /ai/explain`, `POST /ai/draft-strategy`

These are design proposals, not claims that these endpoints exist. See [Section 15](#15-implementation-status-and-recorded-decisions) for how the implementation maps onto them.

---

## 9. Quantitative Integrity and Risk Controls

**Required safeguards**

1. **No performance guarantees.** Even rigorously backtested rules can lose money, including more than a lower-decile projection.
2. **Avoid look-ahead bias.** Signal timestamps and fill pricing must reflect information available when decisions are made.
3. **Mitigate survivorship bias.** Use point-in-time universes where applicable; disclose when historical membership is unavailable.
4. **Account for corporate actions.** Handle adjusted returns consistently and distinguish indices from investable ETF returns.
5. **Avoid overfitting.** Reserve unseen periods for out-of-sample testing and monitor instability under small parameter changes.
6. **Model execution costs.** Fees, slippage and spreads matter especially for frequent turnover and small balances.
7. **Respect sample limits.** Seasonal rules may have few independent annual observations; a seemingly strong backtest may be statistical noise.
8. **Expose correlation/overlap.** Multiple strategies based on one underlying index can share substantial downside risk.
9. **Disclose real-world constraints.** Minimum trade sizes, fractional share availability, taxes, cash yields, FX risk and geographic instrument access vary.
10. **Label data and results.** Historical, simulated, paper and manually recorded real performance must never be confused.
11. **Projection accuracy.** Present uncertainty estimates as model-conditioned distributions, never probability guarantees; stress-test adverse scenarios.
12. **Compliance.** Conduct applicable legal review before personalized advice, broker connectivity, automatic execution or monetized copy trading, particularly for markets in which the product is offered.

---

## 10. MVP Scope and Phased Delivery

**Milestone A — Strategy core**

- Repo/API/data audit and data schema decisions.
- Quant engine and reproducible first three strategies: buy-and-hold/DCA, moving-average trend, periodic rebalancing.
- Baseline metrics, cost model, benchmark comparisons, point-in-time rule conventions and test suite.
- Curated strategy catalog screen and strategy detail view.

*Exit criterion:* independently reproduce a seeded strategy run with the same dated inputs, and explain each decision/trade.

**Milestone B — Simulation and optimization**

- Basket selection (up to three strategies).
- User capital/contributions/horizon form.
- Constrained long-only allocation optimizer and overlap visibility.
- Historical results and percentile projection fan chart with documented methodology.
- CSV/JSON export of assumptions and results as optional stretch scope.

*Exit criterion:* a user can compare a three-strategy proposal with equal-weight and buy-and-hold baselines, then rerun with adjusted assumptions.

**Milestone C — Portfolio tracking**

- Paper portfolios and manually entered real transaction ledger.
- Save plan and projection snapshot.
- Observed-versus-original-versus-updated projection visualization.

*Exit criterion:* later market updates do not mutate an original saved forecast, and contributions are reconciled in tracking.

**Milestone D — AI education and strategy authoring**

- Context-aware finance explanations.
- Backtest/optimization result interpretation.
- Natural-language-to-structured-strategy drafting with approval and schema validation.
- Source and confidence guardrails.

*Exit criterion:* the AI can accurately describe a calculation from engine output but cannot substitute its own return values or silently execute changes.

**Later opportunities (not MVP)**

- Reviewed user-published strategy marketplace and creator profiles.
- Broader multi-region Nifty/ETF data support.
- Portfolio stress testing with explicit macroeconomic scenarios.
- Read-only broker sync and, only after security/compliance work, further integrations.
- Strategy following/alerts and collaboration features.

---

## 11. Functional Acceptance Criteria

| ID | Acceptance criterion |
| --- | --- |
| AC-01 | Existing market exploration flows continue working after Phase 2 integration. |
| AC-02 | A strategy card can be opened to inspect machine-readable and plain-English rules. |
| AC-03 | User can add/remove up to three strategies; basket rejects a fourth with clear feedback. |
| AC-04 | A given backtest run is reproducible from saved strategy/data/config versions. |
| AC-05 | Every backtest identifies date window, benchmark, data basis, costs and no-look-ahead execution convention. |
| AC-06 | Simulation supports USD 200 starting balance, USD 50/month and five-year horizon without assuming more capital than available. |
| AC-07 | Optimizer respects long-only/no-leverage/weights-sum constraints and displays an equal-weight baseline. |
| AC-08 | Fan chart labels percentiles and distinguishes model-based possibilities from certainty. |
| AC-09 | AI explanations do not introduce financial figures absent from the engine results or sourced context. |
| AC-10 | A saved original projection is immutable and can be compared against current paper/manual actual performance. |
| AC-11 | If data quality or sample history is inadequate, product shows a warning or disables misleading metrics. |
| AC-12 | Portfolio screens clearly separate paper holdings from user-reported real holdings. |

**Quant and test expectations**

- Unit tests for contribution timing, fee deduction, missing data, indicator shift, rebalance calculation, cash handling, and currency mismatches.
- Golden test fixtures for known simple strategies, manually cross-checked calculations, and deterministic seeded simulations.
- Parameter-sensitivity and out-of-sample tests for any strategy labelled robust.
- Regression checks confirming no change to Phase 1 terminal exploration.
- UI and API error handling for insufficient data, provider outages, invalid strategy DSL and failed/cancelled jobs.

---

## 12. Success Metrics

**Adoption and activation**

- % of new users who inspect at least one strategy methodology.
- % who successfully complete their first simulation.
- % who save a paper portfolio or investment plan.

**Engagement**

- Repeat simulations per user, purposeful adjustments, saved-plan revisits.
- % of tracked plans receiving a follow-up review.

**Trust and correctness**

- Reproducibility pass rate for identical inputs/versioned datasets.
- Projection and backtest runs with complete assumption metadata.
- Rate of users opening methodology and data-quality disclosures.
- AI factuality evaluation pass rate against known engine outputs.

Avoid using user profit or speculative returns as the primary product success KPI.

---

## 13. Dependencies, Risks, and Open Decisions

**Dependencies**

- Confirm current data APIs provide sufficient daily adjusted price history and licensing rights for backtests. If not, add an appropriate historical provider.
- Confirm ETF availability and whether dividend/reinvestment history is included.
- Decide base currency (initially USD in examples; UAE investors may benefit from AED support).
- Confirm charting library supports fan charts and historical-versus-projected overlays.
- Define market calendar, time-zone and reference-rate conventions.
- Establish persistence/auth status from current application.

**Top delivery risks**

| Risk | Mitigation |
| --- | --- |
| Misleading returns due to data defects | Provenance, quality checks, provider adapters, golden tests |
| Overfit strategies outperforming only in hindsight | Walk-forward splits, sensitivity tests, experimental labels |
| Optimization creates concentrated exposures | Underlying holdings overlap, caps, benchmark comparisons |
| False certainty about future value | Percentiles, stress tests, explicit limits, no guaranteed language |
| Scope creep from marketplace/social/trading | Curated catalog + saved basket first, no order execution |
| AI confidently invents return numbers | Tool-mediated calculations, structured outputs, verification tests |

**Decisions to confirm** (resolved in [Section 15](#15-implementation-status-and-recorded-decisions))

1. Final public product name and brand identity.
2. MVP investment universe: US-listed ETFs only, or US ETFs plus validated Indian instruments?
3. Does the first optimizer optimize strategy sleeves or underlying ETF exposures? Underlying exposure awareness is required either way.
4. Projection default: historical block bootstrap versus parametric Monte Carlo, subject to data adequacy testing.
5. User accounts versus local-only storage in first release.
6. Strategy DSL design and quantitative runtime chosen after code audit.
7. Whether AI drafting launches with the initial MVP or follows after trusted quant infrastructure is complete.

---

## 14. Definition of Done for Phase 2 MVP

The Phase 2 MVP is complete when a user can open the existing terminal, browse a curated strategy catalog, select up to three rules-based strategies, run reproducible historical evaluations, enter an initial and recurring investment plan, compare a constrained portfolio allocation with baselines, inspect transparent lower/median/upper scenario distributions, save a paper plan with its original projection, return to compare observations with that snapshot, and ask the AI to explain methods and results without inventing financial figures or suggesting guaranteed profits.

*End of PRD — Phase 2.*

---

## 15. Implementation status and recorded decisions

This section is maintained alongside the code. It records how the open decisions in Section 13 were resolved after the repository audit, and what is implemented. Code is the authority where this section and the source disagree.

### Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | Product name is **StockHub**. | Rename already made for trademark safety; EMBER was provisional. |
| 2 | MVP universe is **US-listed ETFs, USD only**. Nifty/Indian instruments are not published. | Section 6.2 requires validated instrument, corporate-action and currency data before publication; none is verified. The Explore screen states this limit. |
| 3 | The optimizer works on **strategy sleeves** (each strategy's standalone return stream) and reports **underlying exposure overlap** by asset bucket. | Sleeve weights are what a user selects; overlap keeps concentration visible, as required. |
| 4 | Projection default is **block bootstrap of monthly returns**; **parametric Monte Carlo** is offered as a second method. Both are seeded. Projections are suppressed when fewer than 60 monthly observations exist. | Resampling makes no distribution assumption; the history length rule implements SIM-11. |
| 5 | **Local-only storage** (browser storage), no accounts. | No auth or database exists in the repo; the app is a local single-user tool. Broker credentials are never stored. |
| 6 | The DSL is a **versioned JSON schema** (`schema: 1`) interpreted by a **TypeScript quant library** in `app/src/quant/`, run in the browser. | The repository is a Vite/React app with no Python service in the data path; one language keeps the engine unit-testable under Vitest. The library has no UI dependencies, so it can move behind a service later. |
| 7 | The Copilot ships in the MVP as a **deterministic, tool-mediated assistant** (glossary, engine-result explanations, rule-based natural-language drafting). No external LLM is called. | The repo holds no model credentials. Grounding, figure verification and the confirmation flow are the same ones an LLM adapter would need. |

### Conventions the engine implements

- **Price basis:** dividend-adjusted (total-return) daily closes from OpenBB `adjustment=splits_and_dividends`; dividends are reinvested implicitly. Indices are not investable and are never traded directly.
- **Timing:** a decision uses data through the close of day *t*; the order fills at the close of the next trading day *t+1*, after slippage. Period boundaries (month, quarter, year) are detected from the dates of past closes, so a monthly rule acts on the first trading day of the month and fills the day after. A contribution is credited at the close of its scheduled day (the first trading day of the period) and is invested at the next close toward the targets, without selling. Initial capital is credited at the first close and invested at the second.
- **Costs:** per-trade commission (bps), slippage (bps) and an optional fixed fee. ETF expense ratios are already in the adjusted prices. Taxes are excluded.
- **Cash and rates:** cash earns 0% and the Sharpe/Sortino risk-free rate is 0% unless the user changes it; both are shown in every report.
- **Shares:** fractional shares are assumed and disclosed, since small balances could not otherwise buy one share of a high-priced ETF.
- **Metric availability:** annualized return needs at least one year of data; volatility, Sharpe and Sortino need at least 60 daily observations; otherwise they are shown as unavailable.

### Mapping from API candidates to code

The engine is exposed as functions in `app/src/quant/service.ts` with the same request/response shapes as the candidate endpoints (`runBacktest`, `runOptimization`, `runSimulation`, `validateStrategy`). Job ids are deterministic hashes of the inputs, dataset versions and engine version, so identical requests are idempotent and cacheable.

### Delivery status

Updated as each milestone lands; see the git history for detail.

| Milestone | Status |
| --- | --- |
| A — Strategy core | Delivered: engine, 12-strategy catalog, robustness, Strategies screen with basket, compare and drafts |
| B — Simulation and optimization | Delivered: basket-to-Lab flow, overlap analysis, constrained optimizer with baselines and out-of-sample check, bootstrap and parametric projections with fan chart and scenarios, calculation report with JSON and CSV export |
| C — Portfolio tracking | Delivered: My Portfolio screen, Save Plan from the Lab, paper and manually reported portfolios kept apart, validated ledger with CSV export, content-addressed immutable snapshots, plan vs observed vs reforecast timeline, attribution of the gap, reforecast over selectable horizons |
| D — AI education and strategy authoring | Delivered: Copilot side panel on every screen with screen-scoped context, glossary, strategy/backtest/optimization/projection/portfolio explanations with sources, figure verification against engine output, certainty/advice/action/injection guardrails, natural-language strategy drafting with diff and explicit save |
