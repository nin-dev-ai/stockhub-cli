# Interface design

## Structure

The interface is a dark, amber-accented terminal workspace. [`App.tsx`](../app/src/App.tsx) stacks the command bar, quick bar, workspace tabs, active function panel, and status bar. A function opens as a tab so users can move between market and ticker views without losing context.

## Primary navigation

A strip under the command bar switches between the product's sections: **Explore** (the original terminal) and **Strategies**. Each section opens ordinary workspace tabs, so tabs, the command bar and the quick bar work everywhere. `sectionOf` in [`functions.ts`](../app/src/lib/functions.ts) assigns every function code to a section.

## Strategies screen (`STRAT`)

A filter rail (search, sort, type, risk level, robustness) beside a grid of strategy cards, with a basket bar at the bottom and a drawer on the right. The default sort ranks the robustness verdict first, then Sharpe, then drawdown, never return alone. Cards show CAGR, the difference from the benchmark, max drawdown, Sharpe, the sample window and a short run id. The drawer shows a four-step flow (data, signal, schedule, orders), the exact rules and JSON definition, evidence charts and metrics, robustness, a reason for each trade, assumptions with the dataset version, and warnings. Every result is labelled as a historical backtest. Metrics the sample cannot support show "n/a" with the reason.

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
