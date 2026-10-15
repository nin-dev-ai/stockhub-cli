# Product requirements

## Purpose

StockHub is a local financial intelligence dashboard. It brings market data, company views, and rule-based signals into a command-driven terminal interface. The signal verdicts summarize configured heuristics; they are not predictions or investment advice.

## Primary user flow

1. Install dependencies with `./setup.sh` or the installer described in the [README](../README.md).
2. Start the API and UI with `./start.sh`.
3. Open the Command Center (`CC`) for a market overview.
4. Enter a symbol such as `AAPL` to open its INTEL scorecard, or enter a command such as `AAPL GP` to open a specific function.
5. Switch among workspace tabs while comparing views.

## Current capabilities

- Command Center with market, yield curve, FX, crypto, mover, and news panels.
- Symbol views for intelligence, profile, charts, quotes, historical prices, financials, ratios, dividends, analyst estimates, news, and options.
- Market views for world indices, movers, crypto, FX, and the US yield curve.
- Command parsing, autocomplete, keyboard shortcuts, and persistent workspace tabs.
- Signal classifications for technicals, valuation, fundamentals, analysts, leverage, and dividends.
- Phase 2 strategy terminal (Strategies, Simulation Lab, My Portfolio, Personas, Copilot); see [PRD_phase2.md](PRD_phase2.md) for its requirements and delivery status.
- Phase 3 ([PRD_phase3.md](PRD_phase3.md)): one strategy spread across several ETFs; US House members' trades from the Clerk of the House and a copy-trade backtest that acts on filing dates; read-only Interactive Brokers sync into broker-reported portfolios; paper-account orders (`ORD`) with per-order confirmation, hard limits, a kill switch and an audit log; optional Claude phrasing of Copilot answers with figure checks.

The definitive function list lives in [`app/src/lib/functions.ts`](../app/src/lib/functions.ts); screen wiring lives in [`app/src/App.tsx`](../app/src/App.tsx).

## Product requirements

- A user can reach each registered function from the command bar and see its data or a useful error state.
- Symbol-specific views use the selected ticker, while market-wide views work without one.
- Missing data and provider credential errors remain legible rather than being shown as valid zero values.
- INTEL distinguishes a failed data request from an unsupported or unknown ticker and identifies partial data when a provider call fails.
- Signal rules and thresholds stay inspectable in source code.
- The app can run locally with the setup described in the README.

## Current limits

The app polls providers rather than streaming live ticks. Data completeness depends on OpenBB providers and available credentials. House personas, the IBKR connection and the optional LLM proxy rely on the Vite dev server's proxies. Orders go only to IBKR paper accounts; live trading is out of scope. See the [README](../README.md#known-limits) for user-facing details.
