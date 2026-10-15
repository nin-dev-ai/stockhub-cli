# Interface design

## Structure

The interface is a dark, amber-accented terminal workspace. [`App.tsx`](../app/src/App.tsx) stacks the command bar, quick bar, workspace tabs, active function panel, and status bar. A function opens as a tab so users can move between market and ticker views without losing context.

## Primary navigation

A strip under the command bar switches between the product's sections: **Explore** (the original terminal), **Strategies**, **Simulation Lab** and **My Portfolio**. Each section opens ordinary workspace tabs, so tabs, the command bar and the quick bar work everywhere. `sectionOf` in [`functions.ts`](../app/src/lib/functions.ts) assigns every function code to a section.

## Strategies screen (`STRAT`)

A filter rail (search, sort, type, risk level, robustness) beside a grid of strategy cards, with a basket bar at the bottom and a drawer on the right. The default sort ranks the robustness verdict first, then Sharpe, then drawdown, never return alone. Cards show CAGR, the difference from the benchmark, max drawdown, Sharpe, the sample window and a short run id. The drawer shows a four-step flow (data, signal, schedule, orders), the exact rules and JSON definition, evidence charts and metrics, robustness, a reason for each trade, assumptions with the dataset version, and warnings. Every result is labelled as a historical backtest. Metrics the sample cannot support show "n/a" with the reason.

## Simulation Lab screen (`LAB`)

An inputs pane (starting amount, existing holdings, monthly contribution, horizon, basket, risk objective, weight cap, advanced assumptions) beside a canvas with three tabs and five actions: Run Backtest, Optimize Allocation, Run Projection, Save Plan and View Methodology. Save Plan is enabled only once a projection exists for the current inputs and weights; it opens a drawer to name the plan and choose paper or manually reported tracking. Long-running actions show progress and can be cancelled. Every result carries a label: *Historical backtest*, *Historical weights* or *Future simulation (model-based)*. The projection fan chart labels the 10th, 50th and 90th percentiles and states that the lower line is not a worst case. Weight overrides must sum to 100% and are previewed before they apply. With no basket, the Lab explains the next step and links to Strategies.

## My Portfolio screen (`PORT`)

A rail lists paper plans and manually reported records in separate groups, with a form to record existing holdings without a plan. The main area has three tabs. **Plan vs Observed** shows value, net contributed, gain and cash tiles; a timeline with the original plan's 10th–90th percentile band and median, planned and actual contributions, the observed value and the latest reforecast; a table that splits observed minus planned median into contribution difference, projection error, allocation difference and FX (not applicable); and holdings against plan targets. Paper plans add contribution and rebalance actions; trades are previewed and need confirmation. **Ledger** adds, filters, deletes and exports entries, and refuses entries that would overdraw cash or sell units not held. **Snapshots** lists every snapshot with its integrity badge, inputs, versions and percentiles, and runs reforecasts over selectable horizons. Every view carries its mode badge: *Paper (hypothetical)* in cyan or *Manually reported · not broker-verified* in amber.

## Interaction conventions

- Entering a ticker alone opens `INTEL` for that symbol.
- Commands accept a symbol followed by a function code, such as `AAPL GP`; the parser also accepts a function code followed by a symbol.
- A symbol-requiring function can use the active symbol when entered by itself.
- The command bar provides autocomplete and keyboard navigation. The [README](../README.md#the-function-codes) lists user-facing shortcuts.
- The workspace restores a Command Center tab when all tabs are closed and persists tabs in browser storage.

## Visual conventions

The visual system is defined in [`app/src/index.css`](../app/src/index.css) and [`app/tailwind.config.js`](../app/tailwind.config.js). Reuse the existing terminal colors, type scale, panels, and status treatments when adding a screen. Charts use `lightweight-charts` where appropriate.

## Content conventions

Use concise labels, units, and date ranges for financial values. Distinguish missing data from zero. Show loading and provider error states in the panel where they occur. Describe INTEL outputs as rule-based signals, with the underlying thresholds available in [`signals.ts`](../app/src/lib/signals.ts).

On multi-request market screens (`CC`, `WEI`, `CRYPTO`, `FXC`), a shared notice ([`QueryFailureNotice`](../app/src/components/QueryFailureNotice.tsx)) reports how many requests failed, shows the first error, and offers retry, so a failed request is not mistaken for missing data.

On INTEL, show a data error with retry when the quote or profile request fails and there is no usable identity or price. If some requests fail while other data loads, label the scorecard as incomplete and offer retry.
