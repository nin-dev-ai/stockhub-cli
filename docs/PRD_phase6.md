# StockHub — Phase 6 Plan: Strategies, personas and My Portfolio that make sense and get used

**Document:** Phase 6 plan and walkthrough findings
**Version:** 0.1 (proposed) · **Date:** 18 October 2026
**Status:** Proposed; nothing built yet. Decisions in [Section 7](#7-decisions-needed).
**Starting point:** Phase 5 ([PRD_phase5.md](PRD_phase5.md)).

---

## 1. Why this phase

Phases 3–5 added capability. This phase adds no new data sources or engines. It makes the three things a user actually does work end to end:

1. **Pick strategies** (STRAT) and understand what each is for.
2. **Follow people** (PERS) and decide whether copying them is worth anything.
3. **Run my plan** (LAB → PORT → ORD): build it, save it, and be told when to act.

The findings below come from using the app on 18 October with a fresh browser, the live OpenBB API and the default `./start.sh`, and from checking each one against the code.

## 2. Walkthrough findings

### Strategies (STRAT)

| # | Finding | Evidence |
| --- | --- | --- |
| S1 | **Every card says it lost to the S&P 500.** "vs SPY" is negative on all 21 cards (−0.3 to −5.9 points a year). The trade-off is never stated: SPY's −55% worst fall is not on the screen, so the cards read as "every strategy is worse than buying the index". | STRAT grid, `StrategyCard.tsx` |
| S2 | **A card does not say what to hold today.** The 200-day filter shows CAGR and Sharpe, but not "in SPY since 12 May" or "in short Treasuries". Nothing there tells you what to do. | `StrategyCard.tsx`; `currentTargets` exists in `backtest.ts` but only the Lab uses it |
| S3 | **The plan's jobs are missing from the catalog.** The Lab sorts strategies into core, tactical and diversifier, but STRAT shows 22 overlapping type tags instead (ETF, Index, Diversified, Multi-Asset, Balanced…). | STRAT filter pane; `planRole` in `plan.ts` |
| S4 | **Near-duplicates are shown as separate choices.** There are three 60/40 variants (quarterly, 5-point drift, 70/20/10 cash buffer) and three trend filters on the S&P 500 (200-day, golden cross, 12-month). They hold the same thing, so picking two of them builds a redundant plan. | Catalog |
| S5 | **One thing has two names.** STRAT has a "basket" that opens in the Lab; the Lab calls the same list a "plan". | `strategyStore`, STRAT footer, LAB |

### Building a plan (LAB)

| # | Finding | Evidence |
| --- | --- | --- |
| L1 | **"Build me a plan" gives the core almost nothing.** With a 30% fall limit it proposed 60/40 (core) **20%**, 200-day filter (tactical) **70%**, permanent portfolio 10%. The result holds **85% SPY** from three sleeves that all trade SPY. The "core grows the money" idea is not honoured. | `suggestPlan` in `plan.ts`: it maximises growth inside the fall limit with no role or concentration constraint |
| L2 | **The same plan reports two different concentrations.** The sense check says "68% of the plan is in one asset class"; *What the plan holds today* says 85%. One is the historical average, the other is today; neither is labelled. | `checkPlan` uses `overlap.topBucket` (average); `PlanView` uses current targets |
| L3 | **Out-of-date note.** The Backtest tab still says "Your plan blends the strategies as if their weights were restored daily". The default has been quarterly since Phase 5 A1. | `functions/lab/BacktestView.tsx:60` |
| L4 | **The out-of-sample sentence reads as a contradiction.** It says the weights "did a little worse than an equal split" while the next line shows a higher CAGR (9.3% against 8.9%). The verdict is on Sharpe, and the sentence doesn't say so. | `oosVerdict` in `plan.ts` |
| L5 | **Saving takes five clicks with no guidance.** Build → Use this plan → Projection tab → Run projection → Save Plan. Save Plan stays greyed out until a projection exists, and nothing says why. | `LAB.tsx`, `SavePlanPanel.tsx` |
| L6 | **The inputs pane is a wall.** It has two 45-item ETF lists ("Run on ETF" and "Spread across more ETFs") above the strategy list. Most users never need them. | `InputsPane.tsx` |

### Following the plan (PORT and ORD)

| # | Finding | Evidence |
| --- | --- | --- |
| P1 | **Saved plans are named by date** ("Plan 2026-10-18"). | `SavePlanPanel.tsx` |
| P2 | **The paper plan holds fractions of a share that can't be bought.** It holds 0.2214 SPY, 0.0131 GLD and so on. Paper Orders only trades whole shares, and with the default $200 start no real order is possible. Nothing says so. | `lab.ts` default `fractional: true`, `initial: 200`; `orders.ts` whole-share rule |
| P3 | **Nothing tells you when to act.** When the 200-day filter moves to Treasuries, a quarterly rebalance comes due or a sleeve drifts, the deviation table changes quietly. Alerts exist for personas only. | `PersonaWatcher.tsx`; nothing similar for plans |
| P4 | **Day one is all zeros.** A newly saved plan shows $200 / +$0 / "less than three months have passed" for weeks. | `OverviewView.tsx` |

### Personas (PERS)

| # | Finding | Evidence |
| --- | --- | --- |
| R1 | **The default setup shows stale or empty data.** Without `STOCKHUB_SEC_CONTACT`, PERS shows quarterly 13F only. Jensen Huang, one of the two default follows, shows "No buys or sells". Fixing it means editing the environment and restarting. | Banner in PERS; `stockhub.config.ts` |
| R2 | **The first load is slow, with no progress shown.** Both cards still said "Loading…" after 15 seconds. | PERS on a cold cache |
| R3 | **You can't judge a persona before following them.** "Since public" results and copy backtests appear only after you follow someone and open their card. | `PERS.tsx`, `sinceTrade.ts` |
| R4 | **A persona can't become part of a plan.** A copy-trade backtest exists, but "copy Buffett's 13F" can't be added as a sleeve next to ETF strategies. | `copyTrade.ts` builds a `schedule` strategy the Lab could already run |

## 3. Track S — Strategies that explain themselves

**S-1. Say the trade-off, not just the gap.** Each card gets one line: *"Gives up 2.5 points a year against the S&P 500 to cut its worst fall from −55% to −23%."* Add a pinned "S&P 500 buy and hold" row at the top as the yardstick. In the detail view and Compare, show each strategy's fall in three named crises (2008, March 2020, 2022), next to SPY's. This is the historical stress replay from ML4T Ch. 19, done on data we already load.

**S-2. "Today" on every card.** Show what the strategy holds now, since when, and its last switch. For example: *"In SPY since 2026-05-12 · last switch to SHY on 2026-03-28 · next check 2026-11-02"*. This comes from the backtest's weight history, so it needs no new data.

**S-3. Organise by job.** Show the core, tactical or diversifier badge on each card and filter by it, using the same `planRole` the Lab uses. Collapse the 22 tags into about eight families: Buy and hold, Balanced, Trend, Momentum and rotation, Volatility, Risk parity, Seasonal and timing, Contributions.

**S-4. Show variants as one card.** The three 60/40 variants become one card with a variant switch, and so do the three S&P 500 trend filters. You pick one variant, so near-duplicates can't both end up in a plan. The variants stay individually testable.

**S-5. One word: plan.** The STRAT footer becomes "Add to plan (3/5)" and edits the Lab's plan directly. "Basket" disappears from the UI and the docs.

**Acceptance:** every card's trade-off line matches its backtest; the "Today" line matches `currentTargets` on the fixture; a test proves only one variant per family can be in a plan; e2e: add from STRAT, see it in the Lab plan.

## 4. Track P — A plan you can build, save and follow

**P-1. "Build me a plan" honours its own roles.**
- The core gets at least 40% and is the largest sleeve.
- No asset class goes above 60% unless the user raises the fall limit's growth tilt.
- Sleeves that trade the same ETF count toward each other's concentration.
- Each pick comes with a one-line reason ("Permanent portfolio: lowest overlap with the core; held up best in 2022").
- The out-of-sample sentence names the measure ("lower Sharpe, higher CAGR").
- Both concentration figures are labelled ("today" and "on average since 2004").
- Fixes L1, L2 and L4.

**P-2. A guided save.** After "Use this plan", the Lab runs the backtest and projection by itself and Save is available straight away. Saving asks for a name, prefilled from the plan ("Balanced, 30% fall limit"). A short step line ("1 Choose strategies · 2 Check · 3 Save · 4 Follow") replaces the three Run buttons. The ETF controls move into a collapsed "Run on other ETFs" section. Fixes L5, L6 and P1. The L3 note fix ships first, straight to main.

**P-3. What your money actually buys.** A "Buy list" on the Plan tab and in PORT shows, for the starting amount, whole shares per ETF, leftover cash and the gap from target ("$200 buys 0 SPY: at least $760 is needed to hold every ETF in whole shares"). Paper tracking offers whole shares (default when an IBKR gateway is configured), so PORT and Paper Orders agree. Fixes P2.

**P-4. A to-do list and alerts for your plan.** PORT gets "What needs doing", one row per event:
- a sleeve's signal changed ("200-day filter moved from SPY to SHY on 2026-11-03");
- a rebalance is due under the plan's rule;
- a sleeve drifted past 5 points;
- a monthly contribution is due.

Each row has one action: *Rebalance on paper* or *Open Paper Orders*. The same events feed the existing alert system (browser notification and tab-title count, per-plan mute), with the watcher extended from personas to plans. Fixes P3.

**P-5. Useful from day one, honest after.** Until a plan has three months of its own history, PORT shows "if you had started this plan 1 and 3 years ago" (from saved weights and real prices), clearly labelled as hindsight. After six months, a **health line** compares live results with the saved projection's range. It says "on track" or "below the 10th percentile for 3 months: review" and never trades on its own. This is a light version of the edge-decay monitor in ML4T Ch. 26. Fixes P4.

**Acceptance:**
- On the fixture, a built plan has core ≥ 40% and no asset class above 60%.
- Saving takes at most three clicks after "Use this plan".
- The buy list's whole-share counts match `orders.ts` rounding.
- A signal flip on fixture data produces exactly one to-do item and one notification.
- e2e: build, save, PORT shows the hindsight view and the to-do list.

## 5. Track R — Personas worth following

**R-1. Live without a restart.** The PERS banner gets a "Turn on live filings" field for name and email. The value is stored in this browser and sent only to the local proxy as a header; the proxy uses it as the SEC User-Agent. The environment variable still wins when set. Removes the restart step behind R1.

**R-2. Fast and never blank.**
- Cards show cached results at once with "updated 3 h ago" and refresh behind them.
- Each card loads on its own, with a step line ("filings 12/40").
- A persona with nothing recent says "last trade 2026-08-14 (63 days ago)" instead of "No buys or sells".
- The default follows become personas with recent Form 4 or ARK activity.

Fixes R1 and R2.

**R-3. A scorecard before you follow.** Every persona in the left list shows its "since public" hit rate and average against SPY, plus its median reporting lag. These come from the cache, filled when the persona was last viewed or fetched in the background on idle. A *Sort by results* option ranks them. Fixes R3.

**R-4. A persona as a plan sleeve (experimental).** "Add to plan" on fund and insider cards adds the copy-trade schedule as a sleeve with role *tactical* and an "experimental, stocks" badge. The Lab backtests it with the plan. Paper Orders skips stock holdings (its ETF-only rule stays) and the buy list says so. Fixes R4. Needs decision 2.

**Acceptance:**
- With the contact entered in the UI and no environment variable, the e2e suite loads live filings through the proxy header.
- The cached view renders within 1 s on reload.
- The scorecard reproduces `sinceTrade` on the fixture.
- A copy sleeve backtests in the Lab with no look-ahead (same test as `copyTrade.test.ts`).

## 6. Order, size and workflow

| Order | Item | Why this order | Size |
| --- | --- | --- | --- |
| 0 | L3 note fix | Wrong text on screen today | XS, straight to main |
| 1 | P-1 roles-aware builder, P-2 guided save | The core flow; everything else follows a saved plan | M |
| 2 | S-1 trade-off line and crises, S-2 Today line | Makes the catalog readable | M |
| 3 | P-3 buy list and whole shares | Makes PORT and Paper Orders agree | S |
| 4 | P-4 to-do list and plan alerts | The reason to come back | M |
| 5 | R-1 contact in the UI, R-2 cached and never blank | Personas become live for everyone | M |
| 6 | S-3 jobs and families, S-4 variants, S-5 one word | Catalog tidy-up; touches the store | M |
| 7 | R-3 scorecard, P-5 hindsight and health | Builds on the items above | S each |
| 8 | R-4 persona as a sleeve | Experimental, after decision 2 | M |

**Workflow:** one issue per track (S, P, R) plus one per item, a branch per item, a pull request closing its issue, merged with a merge commit; e2e and unit tests in each PR; docs updated in the same PR. About 12 pull requests.

## 7. Decisions needed

| # | Question | Recommendation |
| --- | --- | --- |
| 1 | Minimum core weight in "Build me a plan" | 40%, and the largest sleeve |
| 2 | Allow a persona copy (single stocks) as a plan sleeve when Paper Orders trades ETFs only | Yes, tracking only and labelled experimental; orders skip the stocks |
| 3 | Merge near-duplicate strategies into one card with variants | Yes; each variant keeps its id, so saved plans keep working |
| 4 | Store the SEC contact in the browser | Yes; it goes only to the local proxy and sec.gov, never into the repo |
| 5 | Default starting amount ($200) | Raise to $1,000 so a whole-share buy list is possible, or keep $200 and show the minimum |

Out of scope: new data sources, Senate trades, live trading, the heavier ML4T items (Deflated Sharpe, HRP, regimes). They can come back once these flows are solid.
