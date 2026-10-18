<img src="assets/readme-banner.svg" alt="stockhub cli project banner" width="100%" />

[![Frontend build](https://github.com/nin-dev-ai/stockhub-cli/actions/workflows/frontend-build.yml/badge.svg)](https://github.com/nin-dev-ai/stockhub-cli/actions/workflows/frontend-build.yml)

# StockHub — a local stock research and backtesting terminal

StockHub brings **market data, company research, ETF strategy backtesting, SEC filings, and paper portfolio tracking** into a keyboard-driven dashboard. It runs locally with [OpenBB Platform](https://github.com/OpenBB-finance/OpenBB), React, TypeScript, and TradingView Lightweight Charts. Core market views use free Yahoo Finance data without an API key.

The amber-on-black interface turns raw numbers into inspectable, **rule-based signals**. Signals and historical simulations are research tools, not predictions or investment advice.

[Quick start](#quick-start) · [Features](#what-you-can-do) · [Commands](#try-these-commands) · [Detailed documentation](docs/README.md)

---

## Quick start

Review the scripts, then install and run locally on macOS or Linux:

```bash
git clone https://github.com/nin-dev-ai/stockhub-cli.git
cd stockhub-cli
./setup.sh
./start.sh
```

Open **http://localhost:5173/**. `./stop.sh` stops both local servers. The setup installs OpenBB Platform and frontend dependencies; allow a few minutes and about 2 GB of disk space.

Alternatively, inspect [`install.sh`](install.sh) and use the one-line installer, which clones to `~/stockhub-cli`, installs dependencies, and launches the app:

```bash
curl -fsSL https://raw.githubusercontent.com/nin-dev-ai/stockhub-cli/main/install.sh | bash
```

The installer will:

1. Check that `git`, Python 3.10+, and Node.js 18+ are on your system (and tell you exactly how to install them if not)
2. Clone this repo to `~/stockhub-cli`
3. Install OpenBB Platform and all its data providers (~3 min)
4. Install the UI dependencies (~1 min)
5. Launch both servers and open the dashboard in your browser

**Windows users:** use WSL (Ubuntu) for the local setup.

### Every launch after that

```bash
cd ~/stockhub-cli
./start.sh     # launches API + UI, opens your browser
./stop.sh      # when you're done
```

Core market views use **Yahoo Finance** without an API key. Optional providers (FRED, TradingEconomics, FMP, Polygon, etc.) can be added to `~/.openbb_platform/user_settings.json`.

### Prerequisites

- macOS or Linux (Windows via WSL)
- Python 3.10, 3.11, or 3.12
- Node.js 18+
- ~2 GB free disk (OpenBB pulls many provider libraries)

---

## What you can do

| Area | Use it for |
| --- | --- |
| **Market overview** | Scan indices, movers, crypto, FX, news, and the US Treasury yield curve from the Command Center. |
| **Stock research** | Open a ticker for charts, quotes, financials, valuation ratios, dividends, analyst estimates, options, and a rule-based INTEL scorecard. |
| **ETF strategies** | Inspect 21 rules-based strategies, compare historical backtests, and test a strategy on other supported ETFs. |
| **Filings and personas** | Follow public SEC filings and supported US House disclosures, with source links and reporting-delay context. |
| **Plans and portfolios** | Build and simulate a plan, track hypothetical or manually reported holdings, and optionally connect an IBKR paper account. |
| **Copilot** | Ask for explanations grounded in on-screen results; optional Claude phrasing does not expand its allowed actions. |

## Try these commands

Enter a ticker or function code in the command bar:

```text
AAPL          Open the INTEL scorecard
AAPL GP       Chart Apple shares
AAPL KEY      Review valuation and financial ratios
STRAT         Explore ETF strategies and backtests
PERS          Follow public filings and trades
LAB           Build and simulate a multi-strategy plan
PORT          Review saved plans and portfolios
HELP          Open the full command directory
```

The detailed [feature and command guide](docs/FEATURES.md) covers every screen, data source, method, and limit. StockHub never places live trades; its optional IBKR order flow is restricted to paper accounts.

---

## How it works

- **Python API**: `openbb-api` (FastAPI + Uvicorn) on port 6900. Exposes `/api/v1/...`  
- **Frontend**: Vite + React + TypeScript on port 5173. Vite proxies `/api` to the Python process.
- **Data**: OpenBB connects to Yahoo Finance and optional providers. Some fundamental, options, and calendar views need provider keys or have limited coverage.
- **Signals**: plain-JS rules in `app/src/lib/signals.ts` — transparent, auditable, tweakable.

```
┌──────────┐  HTTP   ┌────────────────┐  HTTP   ┌──────────────┐
│ Browser  │────────▶│ Vite dev (5173)│────────▶│ OpenBB (6900)│──▶ Yahoo, SEC, FRED…
└──────────┘         │ + /api proxy   │         └──────────────┘
                     └────────────────┘
```

---

## Important limits

- Quotes and news are polled; availability depends on upstream data providers. Some economic and fundamental views need optional API keys.
- Strategy backtests use historical, dividend-adjusted data and modeled costs. They are not forecasts or trading recommendations.
- SEC and House disclosures can arrive after trades. StockHub shows filing dates so a backtest does not treat delayed information as if it were known earlier.
- Interactive Brokers orders are limited to paper accounts. The gateway integration has been checked against a mock gateway, not a real account.
- Setup pins OpenBB 4.x. The detailed [data coverage and feature limits](docs/FEATURES.md#known-limits) explain provider quirks and optional integrations.

---

## Tests

From `app/`: `npm test` runs the unit tests, `npm run e2e` the browser end-to-end suite (all data answered from fixtures, so it needs no services), and `LIVE=1 npx vitest run src/quant/live*.test.ts` the opt-in checks against real data. CI runs the first two on every push and pull request.

## Configuration (optional)

Every optional feature is switched on by an environment variable, set in your shell or in an uncommitted `app/.env` (copy [`app/.env.example`](app/.env.example)). The local server prints which features are on when it starts.

| Variable | Turns on | Notes |
| --- | --- | --- |
| `STOCKHUB_SEC_CONTACT` | Live SEC filings and alerts on the Personas screen | Your name and email; the SEC requires a contact in the User-Agent and it is sent only to sec.gov |
| `IBKR_GATEWAY_URL` | Interactive Brokers read-only sync and paper orders | Default `https://localhost:5000`; on a Mac use `https://localhost:5001` (AirPlay holds 5000) |
| `STOCKHUB_LLM_KEY` (`STOCKHUB_LLM_MODEL`, `STOCKHUB_LLM_URL`) | Claude wording for Copilot answers | The key stays in the local server process |
| `STOCKHUB_API_URL` | A market data API on another address | Default `http://127.0.0.1:6900` |

`npm run dev` and `npm run preview` (after `npm run build`) use the same routes, from [`app/stockhub.config.ts`](app/stockhub.config.ts).

## Adding API keys (optional)

```bash
# Edit this file
~/.openbb_platform/user_settings.json
```

```json
{
  "credentials": {
    "fred_api_key": "…",
    "fmp_api_key": "…",
    "intrinio_api_key": "…"
  }
}
```

Restart the API after changing (`./stop.sh && ./start.sh`).

---

## Repository map

| Path | Purpose |
| --- | --- |
| [`setup.sh`](setup.sh), [`start.sh`](start.sh), [`stop.sh`](stop.sh) | Install and run the local OpenBB API and browser UI |
| [`app/src/functions/`](app/src/functions/) | Market, company, strategy, persona, lab, and portfolio screens |
| [`app/src/quant/`](app/src/quant/) | Strategy rules, backtests, projections, and filing analysis |
| [`app/src/store/`](app/src/store/) | Local workspace, plan, and portfolio state |
| [`docs/`](docs/) | Detailed feature guide, methods, design, and technical decisions |

For setup or feature questions, [open an issue](https://github.com/nin-dev-ai/stockhub-cli/issues). Maintained by [nin-dev-ai](https://github.com/nin-dev-ai).

---

## License

- StockHub application code currently has no published license file; contact the maintainer before reusing it.
- OpenBB Platform: AGPL-v3 (upstream).
- Yahoo Finance data: subject to Yahoo's terms — personal use only.
