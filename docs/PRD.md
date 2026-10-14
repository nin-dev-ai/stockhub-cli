# Product requirements

## Purpose

BBterminal is a local financial intelligence dashboard. It brings market data, company views, and rule-based signals into a command-driven terminal interface. The signal verdicts summarize configured heuristics; they are not predictions or investment advice.

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

The definitive function list lives in [`app/src/lib/functions.ts`](../app/src/lib/functions.ts); screen wiring lives in [`app/src/App.tsx`](../app/src/App.tsx).

## Product requirements

- A user can reach each registered function from the command bar and see its data or a useful error state.
- Symbol-specific views use the selected ticker, while market-wide views work without one.
- Missing data and provider credential errors remain legible rather than being shown as valid zero values.
- Signal rules and thresholds stay inspectable in source code.
- The app can run locally with the setup described in the README.

## Current limits

The app polls providers rather than streaming live ticks. Data completeness depends on OpenBB providers and available credentials. See the [README](../README.md#known-limits) for user-facing details.
