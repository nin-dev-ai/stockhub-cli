# StockHub features and commands

The detailed behavior of StockHub’s market views, strategy tools, personas, portfolio features, and Copilot. For installation and the shortest path to a first result, start with the [README](../README.md).

## Market and research views

### Command Center (`CC`) — the landing page
One screen, 30-second briefing: US indices with sparklines, yield-curve shape (flat / normal / inverted), FX majors, BTC/ETH, top 5 gainers + losers (click to drill in), headline news.

### INTEL (`<TICKER>` or `AAPL INTEL`) — the scorecard
Synthesizes the noisy stuff into an interpretable opinion:

```
INTELLIGENCE VERDICT   BULLISH
● 8 bullish   ● 2 neutral   ● 1 bearish

TECHNICAL              VALUATION              FUNDAMENTALS
● Above 50d MA +5.1%   ● Fair P/E 22.4x       ● Revenue growing +12%
● Above 200d MA +8.2%  ● Rich EV/EBITDA 25x   ● Operating margin strong
● Upper range 73% of   ● Fwd P/E improving    ● Low leverage

ANALYSTS               DIVIDEND
● Buy consensus        ● Healthy payout
● Bullish target +14%
```

Each dot is a *rule*, not a prediction — see `app/src/lib/signals.ts` for the thresholds. It's meant to save the 15 minutes of reading, not replace judgement.

### The function codes
Type any of these in the command bar:

| Code    | What it shows                              |
|---------|--------------------------------------------|
| `CC`    | Command Center dashboard (home)            |
| `HELP`  | Full function directory                    |
| `<TICKER>` | Opens INTEL scorecard                   |
| `DES`   | Company description / profile              |
| `GP`    | Candlestick chart, 1M–5Y                   |
| `QR`    | Live quote (refreshes every 3s)            |
| `HP`    | Historical prices table                    |
| `FA`    | 5-year income statements                   |
| `KEY`   | All ratios (valuation, growth, margins…)   |
| `DVD`   | Dividend history + annual totals           |
| `EE`    | Analyst targets + recommendation           |
| `NI`    | Company news (50 headlines)                |
| `OMON`  | Full options chain — calls / strike / puts |
| `WEI`   | World equity indices                       |
| `MOV`   | Market movers (gainers / losers / active)  |
| `CRYPTO`| Top-12 crypto prices + sparklines          |
| `FXC`   | Major FX pairs                             |
| `CURV`  | US Treasury yield curve + spreads          |

| `STRAT` | Strategies: curated rules-based ideas, backtests, robustness, basket |
| `LAB`   | Simulation Lab: backtest a basket, optimize weights, project a range of outcomes |
| `PORT`  | My Portfolio: saved plans, paper and manually reported holdings, plan vs observed |

Syntax: `[SYMBOL] CODE` — e.g., `TSLA KEY`, or `WEI` (no symbol), or just `NVDA` (defaults to INTEL).

Keyboard: `↑/↓` walks history, `⇥` autocompletes codes, `/` focuses the command bar, `<GO>` or `Enter` executes.

---

## Strategies (`STRAT`)

A catalog of 21 rules-based strategies on US-listed ETFs (USD): buy-and-hold, dollar-cost averaging, a 200-day trend filter, a 50/200-day golden cross, an RSI(2) pullback rule (experimental), 60/40 rebalancing by schedule and by drift threshold, a drawdown cash reserve, momentum rotation, dual momentum, sector momentum, a five-asset global trend portfolio, an inverse-volatility mix, volatility targeting (no leverage), a seasonal rule (experimental), a cash buffer, a 12-month stocks-or-bonds rule, and permanent, all-weather style, three-fund and golden butterfly portfolios. Every card says what the strategy gave up or gained against SPY in growth and worst fall, and what it holds today and since when; buy-and-hold SPY stays first as the yardstick. Open a card to see its falls in the 2008, 2020 and 2022 crises, the exact rules in plain English and as JSON, the evidence against an SPY buy-and-hold benchmark, robustness checks, and a reason for every trade. Add up to three to a basket and compare them on the same dates. Fork a strategy into an editable draft stored in your browser.

**Run strategies on other ETFs.** The sidebar's *Test against ETFs* swaps SPY (equity) and SHY (defensive) for any of about 40 supported ETFs — sectors, factors, international markets including INDA (MSCI India), bonds, T-bills and commodities — across every strategy that trades them; benchmarks follow the equity swap. Inside a strategy, *Run on other ETFs* replaces any of its ETFs individually and saves the variant as a draft. *Spread across several ETFs* runs the same rules on up to six ETFs at once (for example the golden cross on SPY, QQQ and DIA) with the money split equally, and reports each ETF's contribution, how closely they moved together, and whether spreading made the worst drawdown shallower. Parameters were tuned on the original ETFs, and an ETF with a shorter history shortens the shared test window.

These are historical tests on dividend-adjusted prices with modeled costs, not forecasts or advice. Signals use data through the close and fill at the next close. The full method, including conventions and limits, is in [docs/PRD_phase2.md](PRD_phase2.md) and [docs/technical_design.md](technical_design.md).

### Personas (`PERS`)

**Live filings.** Besides the quarterly 13F, each fund manager and insider persona reads the SEC's own filing lists, so the screen is days old, not a quarter old: Form 3/4/5 (insider and 10%-owner trades, filed within two business days) and Schedule 13D/G (stakes above 5%, filed within days). Every row shows the SEC's acceptance time to the minute; each card says how long ago its newest filing arrived, when it was last checked and how many filings are new since you last looked, and the screen rechecks every five minutes. For example, Berkshire's October 2026 Lennar purchases appear a few days after the trades, long before the next 13F. **Alerts:** tick *Alert me to new filings* on the Personas screen and StockHub checks your followed personas every ten minutes while it is open in any tab, shows a browser notification for each new purchase, sale or stake report (never twice; grants, tax withholding and gifts are skipped; more than four at once are summed up), and puts the count in the tab title; each persona can be muted. **Cathie Wood** also gets daily rows: ARK publishes every ETF's trades each day, read from a free third-party feed (arkfunds.io, typically a day behind, shares and fund weight but no price) and cross-checked against the date of ARK's own holdings file. Funds with no insider or large-holder filings (most hedge funds) have nothing newer than their 13F, and the card says so instead of showing an old quarter as current. **Setup:** the SEC refuses automated requests without a contact in the User-Agent, so start StockHub with `STOCKHUB_SEC_CONTACT="Your Name you@example.com" ./start.sh` (the contact is yours, is read from the environment, is never stored in the repo, and is sent only to sec.gov). Without it the screen falls back to the quarterly data and says how to turn live filings on.

Follow people whose trades are published in free, official filings (no API key), merged into one timeline. **Fund managers** via Form 13F: Warren Buffett (Berkshire Hathaway), Bill Ackman (Pershing Square), Cathie Wood (ARK), Stanley Druckenmiller (Duquesne), David Tepper (Appaloosa), Li Lu (Himalaya) and Michael Burry (Scion); the screen infers new, added, trimmed and sold-out positions between the latest two quarters. **Corporate insiders** via Form 4: Jensen Huang (NVDA), Mark Zuckerberg (META), Elon Musk (TSLA) and Jeff Bezos (AMZN), with exact dates, shares, prices and values. **US House members** via the Periodic Transaction Reports they file with the Clerk of the House: Nancy Pelosi, Josh Gottheimer, Ro Khanna, Michael McCaul and Dan Crenshaw, or any member with a report this year or last, found by name or district. StockHub reads the electronically filed reports and shows each trade's date, filing date, owner (often a spouse), asset and amount range; amounts are ranges, not values, reports can come up to 45 days after the trade, and scanned paper reports (Ro Khanna files on paper) are linked, not read. Add any fund by its SEC CIK or any insider by ticker and name. Each persona gets a summary card; the table links every row to its original filing and opens a chart for tickers. Senators and the President are not offered yet. Every trade with a ticker also shows **Since public**: the stock's move from the first market close a follower could have traded at, after the trade became public, to today, and the difference from SPY over the same days; each card sums it up (how bought and sold stocks did against SPY, and the share of trades on the right side). The newest 60 trades per persona are measured. **Backtest copying** on a fund manager's card holds their 25 largest 13F holdings by value from each quarter's 45-day filing deadline over about two years (CUSIP codes mapped to tickers with OpenFIGI, free and keyless) and compares it with holding from the quarter end, which no copier could do; on an insider's card it copies their open-market buys and sales from the first close after each Form 4 became public. On a House member's card it asks "what if I had copied them?": it holds the stocks they bought (equal weights, since amounts are ranges) from the day each report became public, runs the same thing from the trade dates as an impossible best case, compares both with SPY, and shows what the reporting delay cost. Following never places trades.

### Simulation Lab (`LAB`)

**Plan tab.** The Lab opens on a Plan tab that treats the basket as a plan of up to five strategies, each with a job: **Core** (a mostly-stock mix held long term), **Tactical** (follows a signal and steps out of the market) or **Diversifier** (spread across stocks, bonds and gold). It shows each strategy's holdings today, editable weights that always total 100%, how often money is moved back to those weights (quarterly by default; once a year, monthly, when a strategy drifts 5 points, never, or every day as an idealised comparison, each rebalance paying the Lab's slippage), and the plan's result against the worst fall you say you would accept, with the every-day figure beside it. *What the plan holds today* adds each strategy's current holdings times its weight, by ETF and by asset class. *Does this plan make sense?* lists plain checks with one-click fixes: strategies that do almost the same thing (for example three S&P 500 strategies), no core or no second job, one asset class above 60%, slivers under 5%, and a worst fall past your limit. *Add a strategy* ranks the catalog by fit and shows the plan's worst fall now and with it; *Build me a plan* tests the catalog, picks a core plus sleeves that do different jobs, and sets the weights with the highest growth that stays inside your limit, keeping the core at 40% or more and the largest sleeve, and every asset class under 60% where it can, with a one-line reason for each pick; it then re-picks the weights using only the earlier 60% of history and says how they did on the later years against an equal split and the best single strategy, flagging a weak result. Both only propose; nothing changes until you click.

Under *Run on other ETFs* (folded away until you open it), choose the ETF to run the plan on: the S&P 500 (SPY), Nasdaq-100 (QQQ), Dow 30 (DIA), total US market (VTI) or S&P MidCap 400 (MDY), all trading since 2001 or earlier, or any other supported ETF. It replaces SPY in every basket strategy that trades it and becomes the benchmark. Open a basket in the Lab, enter a starting amount (for example $200), a monthly contribution (for example $50), how far to **look forward** (the projection horizon, 1 to 30 years), how far to **look back** (the years of history to test, 1 to 30, or all available, which is about 22 years; signals use the history before the window, so even short windows trade from the first day, and projections need at least 5 years of history) and a risk objective. You can also ask the Copilot, for example "test the last 10 years and project 5". A step line leads from strategies to *Check the plan*, *Save* and *Follow in My Portfolio*, and each tab runs its part the first time you open it. **Backtest** shows what the plan would have done with your cash flows next to equal weight and SPY buy-and-hold. **Allocation** proposes long-only, no-leverage weights for lower volatility, balanced risk and growth, names the constraints that bind, flags strategies that overlap in what they own, and checks the result out of sample; you can override the weights. **Projection** simulates thousands of possible paths from historical monthly returns and shows a lower, median and upper range (10th, 50th, 90th percentile) with stress scenarios. **View Methodology** lists every assumption, seed and version, and exports JSON and CSV. **Save Plan** stores the plan and its projection in My Portfolio.

The ranges are model-based possibilities, not forecasts: the lower line is not a worst case and the upper line is not a maximum. With too little history, no projection is shown.

### My Portfolio (`PORT`)

A saved plan keeps its inputs, weights, strategy versions and projection as a snapshot that cannot change; a fingerprint shows it is intact. Track it as a **paper** portfolio (hypothetical trades at market closes, with one-click contributions and a previewed rebalance to the plan's targets) or as **manually reported** real holdings you enter yourself, which StockHub labels as not broker-verified. You can also record holdings you already own without a plan. The overview charts the original range, your observed value and contributions, and the latest reforecast, and splits the gap from the plan's median into contribution difference, projection error and allocation difference. **Reforecast** re-runs the plan on current data over 1 to 20 years and adds a new snapshot without touching earlier ones. The ledger exports to CSV. Everything is stored in this browser.

**Interactive Brokers (read-only).** *Interactive Brokers (read-only)* in the My Portfolio sidebar reads an IBKR account through IBKR's Client Portal Gateway running on your computer: balances, positions and whether it is a paper account. *Sync* adds the long US-dollar stock and ETF positions to a **broker-reported** portfolio (new, or a plan saved from the Lab as broker-reported) as dated ledger entries at the broker's prices, so the plan-versus-observed view works on real holdings. The connection can only read: order paths are blocked in code before any request is sent, and no login is stored (the gateway holds the session). Start the gateway, log in on its page, and start StockHub with `IBKR_GATEWAY_URL` if it is not on `https://localhost:5000`. On a Mac, AirPlay Receiver occupies port 5000, so set `listenPort: 5001` in the gateway's `root/conf.yaml` and use `IBKR_GATEWAY_URL=https://localhost:5001 ./start.sh`.

**Paper orders (`ORD`).** The Paper Orders screen proposes whole-share orders that move an IBKR **paper** account toward a saved plan's targets (only the plan's tickers; other holdings are left alone). You preview each order with IBKR (commission and equity change), confirm it, and answer any question IBKR asks yourself. Live accounts are refused in code. Every order must pass hard limits: StockHub's supported ETFs only, whole shares, no short sales, market or limit orders, a per-order cap and a daily cap you set. A kill switch cancels the account's open orders and blocks sending until you turn trading back on, and an append-only audit log records every step and exports to JSON. The Copilot can open this screen but cannot send, confirm or cancel orders.

### Copilot

The **Copilot** button at the right of the navigation strip opens a side panel on any screen. It defines terms (DCA, CAGR, Sharpe, drawdown, percentiles, Nifty and more), explains the open strategy's exact rules, risks and evidence, explains the Lab's backtest, optimizer weights and binding constraints, and projection, and explains why a portfolio differs from its plan. It can run a strategy on other ETFs ("run the golden cross on the Nasdaq", "use BIL instead of SHY") or across several at once ("run the golden cross on SPY, QQQ and DIA"), offer to follow a persona ("follow Warren Buffett's trades", or explain why a politician cannot be followed) and open the Personas screen, summarize the trades loaded on the Personas screen, propose Lab inputs ("run my plan on QQQ with $500 a month for 10 years", "run my plan across SPY, QQQ and DIA") that apply only when you click *Apply to Lab*, build a whole plan ("build me a plan with a 25% fall limit", or "conservative", "balanced", "aggressive") by testing the catalog and proposing strategies and weights that apply only when you click *Use this plan* (the card can undo it), and turn a description such as "hold SPY above its 200-day moving average, otherwise bonds" into a strategy definition, show the parameters it assumed and a diff, and save it as a draft only when you confirm. Every number it states comes from an engine result on screen or vetted product text; an answer with any other figure is withheld. Its access is fixed in four levels (see [PRD 6.6.1](PRD_phase2.md)): it reads only the open screen, makes additive changes only on your click, never edits records and never trades. It refuses to promise returns, give buy or sell advice, take other actions, or follow instructions embedded in text. It is rule-based and calls no external AI service by default. Optionally, start StockHub with `STOCKHUB_LLM_KEY=<Anthropic API key> ./start.sh` and Claude rewords each answer more naturally: it receives only your message and the computed answer, gets no tools, and its wording is shown only if every number matches the computed answer (otherwise the rule-based wording stays). The key stays in the local server and is never sent to the browser.

---

## Known limits

- **Polling, not streaming.** Yahoo Finance has no WebSocket in OpenBB, so quotes refresh every 3–60s depending on the panel. The IBKR connection reads positions and sends paper orders but does not stream quotes.
- **Yahoo symbol quirks.** A handful of Asian indices (`^N225`, `^HSI`, `^AXJO`, `^TWII`) and a few crypto tickers don't return via OpenBB's Yahoo provider; those cells show "—".
- **Backtests are history, not forecasts.** Strategy results depend on the data window (the common history starts 2004-11-18, limited by GLD), modeled costs, and a fixed ETF universe that is not point-in-time. Indian-listed instruments such as the Nifty 50 are not offered because validated data is not available; INDA, a US-listed MSCI India ETF, is. Picking an ETF that started after 2004 shortens the common window.
- **Persona trades are delayed.** 13F holdings are quarter-end snapshots filed up to 45 days later; changes between them are inferred and exclude shorts and cash. Live SEC filings need `STOCKHUB_SEC_CONTACT`; without it, Form 4 trades come from the SEC provider, which returns only about the last four months per company. With it, filings are read from EDGAR directly (the newest 30 within 120 days per persona). House reports can arrive 45 days after the trade, give amount ranges rather than values, and only electronically filed reports from this year and last are read (paper filings are linked). Senators and the President are not available. Copy-trade backtests cover House members only and under two years, so they are weak evidence.
- **The Copilot is rule-based.** It understands a fixed set of question types and strategy patterns (fixed weights, moving-average trend, momentum, volatility target, calendar season, trailing-return filter, DCA entry, drawdown reserve). Anything else gets a list of what it can do rather than a guess. Optional Claude phrasing rewords answers but does not widen what the Copilot understands or can do.
- **IBKR is paper-only for orders and untested against a real account.** The read-only sync and paper orders were verified against a mock gateway with IBKR's documented responses, not a real IBKR login. Only long US-dollar stocks and ETFs are synced; options, futures, other currencies and shorts are listed but not tracked. Deposits are not visible, so new holdings count as money in. Orders are limited to StockHub's supported ETFs, whole shares, market or limit; live accounts are refused.
- **Rules are heuristics.** The INTEL signals are rules of thumb, not predictions. Tweak the thresholds in `signals.ts` to match your own framework.
- **News comes from RSS, not OpenBB.** OpenBB's `yfinance` news provider returned no data in testing, so company news (`NI`, INTEL headlines, CC headlines) reads Yahoo Finance's public RSS feed and falls back to Google News. No key needed, but the feeds are unofficial. Like House reports, SEC filings, ARK, OpenFIGI, the IBKR gateway and the optional LLM, they go through StockHub's local server (`./start.sh`, `npm run dev`, or `npm run build && npm run preview`); a plain static host has none of these routes.
- **OpenBB 4.x only.** `setup.sh` pins `openbb>=4.3,<5`. OpenBB 5 uses different API routes and every data call would return 404.
- **Economic calendar, CPI, world news** need provider API keys (TradingEconomics, FRED, Biztoc). The UI handles the 401 gracefully.

---
