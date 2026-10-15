# Interface design

## Structure

The interface is a dark, amber-accented terminal workspace. [`App.tsx`](../app/src/App.tsx) stacks the command bar, quick bar, workspace tabs, active function panel, and status bar. A function opens as a tab so users can move between market and ticker views without losing context.

## Primary navigation

A strip under the command bar switches between the product's sections: **Explore** (the original terminal), **Strategies**, **Personas**, **Simulation Lab** and **My Portfolio**. Each section opens ordinary workspace tabs, so tabs, the command bar and the quick bar work everywhere. `sectionOf` in [`functions.ts`](../app/src/lib/functions.ts) assigns every function code to a section.

## Strategies screen (`STRAT`)

A filter rail (search, sort, type, risk level, robustness, and *Test against ETFs*: an equity ETF replacing SPY and a defensive ETF replacing SHY, with a reset and an "only strategies that changed" filter) beside a grid of strategy cards, with a basket bar at the bottom and a drawer on the right. The default sort ranks the robustness verdict first, then Sharpe, then drawdown, never return alone. Cards show CAGR, the difference from the benchmark, max drawdown, Sharpe, the sample window and a short run id. While the ETF switch is active the header names the swap and counts retargeted and unchanged strategies, and unsaved variants carry an "ETF variant" badge. ETF dropdowns are grouped by asset class and note histories that start after 2004. The drawer shows a four-step flow (data, signal, schedule, orders), a *Run on other ETFs* mapper (one dropdown per ETF the strategy uses, validated before it saves the variant as a draft), the exact rules and JSON definition, evidence charts and metrics, robustness, a reason for each trade, assumptions with the dataset version, and warnings. Every result is labelled as a historical backtest. Metrics the sample cannot support show "n/a" with the reason.

## Simulation Lab screen (`LAB`)

An inputs pane (starting amount, existing holdings, monthly contribution, horizon, basket, risk objective, weight cap, advanced assumptions) beside a canvas with three tabs and five actions: Run Backtest, Optimize Allocation, Run Projection, Save Plan and View Methodology. Save Plan is enabled only once a projection exists for the current inputs and weights; it opens a drawer to name the plan and choose paper or manually reported tracking. Long-running actions show progress and can be cancelled. Every result carries a label: *Historical backtest*, *Historical weights* or *Future simulation (model-based)*. The projection fan chart labels the 10th, 50th and 90th percentiles and states that the lower line is not a worst case. Weight overrides must sum to 100% and are previewed before they apply. With no basket, the Lab explains the next step and links to Strategies.

## My Portfolio screen (`PORT`)

A rail lists paper plans and manually reported records in separate groups, with a form to record existing holdings without a plan. The main area has three tabs. **Plan vs Observed** shows value, net contributed, gain and cash tiles; a timeline with the original plan's 10th–90th percentile band and median, planned and actual contributions, the observed value and the latest reforecast; a table that splits observed minus planned median into contribution difference, projection error, allocation difference and FX (not applicable); and holdings against plan targets. Paper plans add contribution and rebalance actions; trades are previewed and need confirmation. **Ledger** adds, filters, deletes and exports entries, and refuses entries that would overdraw cash or sell units not held. **Snapshots** lists every snapshot with its integrity badge, inputs, versions and percentiles, and runs reforecasts over selectable horizons. Every view carries its mode badge: *Paper (hypothetical)* in cyan or *Manually reported · not broker-verified* in amber.

## Personas screen (`PERS`)

A rail of personas with checkboxes (preset and user-added, with a remove control for added ones), an add-by-name form with a chamber choice, and a source note. The main area has a filter bar (ticker or asset search, All / Purchases / Sales), one summary card per followed persona (click to filter the table to that persona), and a merged table sorted by disclosure date. Purchases are green, sales red; tickers open a chart tab; each row links to its filing. Without an FMP key the main area shows a *Connect the disclosure feed* panel with setup steps instead of data. A persona without a feed says why on its card.

## Copilot panel

A **Copilot** toggle at the right of the primary navigation opens a 360px panel beside the active screen; the open state persists, the conversation does not. A strip names what the Copilot can see: the screen and, only for that screen, the open strategy, Lab results or portfolio. Answers show a title, short paragraphs and lists, a *Figures traced to engine* badge when they quote results, and a sources line. Withheld answers carry a red *Withheld* badge. An ETF variant or drafted strategy appears as a card with a diff against the curated strategy it resembles (or the strategy it edits), the editable JSON with generated rules, and Save draft / Cancel; nothing is saved without that click. A persona answer shows a *Follow* button (or *Follow as House member / Senator* for a new name) that follows the persona and opens the Personas screen. Suggested prompts change with the screen and with what has been calculated.

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
