# Interface design

## Structure

The interface is a dark, amber-accented terminal workspace. [`App.tsx`](../app/src/App.tsx) stacks the command bar, quick bar, workspace tabs, active function panel, and status bar. A function opens as a tab so users can move between market and ticker views without losing context.

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
