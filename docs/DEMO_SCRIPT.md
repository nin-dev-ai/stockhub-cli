# StockHub demo walkthrough

Use live values from the app when recording; market prices and filings change.

1. Run `./start.sh` and open the Command Center. Show indices, movers, and the yield curve.
2. Enter `AAPL` to open INTEL. Explain that each signal is a published rule, not a prediction.
3. Enter `AAPL GP` for the price chart, then `AAPL KEY` for financial ratios.
4. Open `STRAT`, inspect a strategy's rules, and show its historical comparison with SPY.
5. Open `PERS` and follow a public filing to its source. Point out the trade date and filing date.
6. Open `LAB` to build and backtest a hypothetical plan. Show the assumptions and range of simulated outcomes.
7. Close on the local setup and the [known limits](FEATURES.md#known-limits), including delayed filings and paper-only IBKR orders.

## Shot list

- Amber terminal UI and command bar autocomplete
- INTEL scorecard with a source rule or threshold
- Strategy rules and backtest methodology
- Filing source link and reporting delay
- Simulation assumptions and limitations
