# StockHub — Phase 4 Plan: Plans that make sense, personas that are current

**Document:** Phase 4 plan and research notes
**Version:** 1.0 · **Date:** 16 October 2026
**Status:** Approved for implementation; progress in [Section 5](#5-delivery-status).
**Starting point:** Phase 3 ([PRD_phase3.md](PRD_phase3.md)).

---

## 1. Problems

**Plans.** A plan is a basket of up to three strategies whose money split is chosen by an optimizer. Checked on 16 October by adding "Buy and hold", the "200-day filter" and the "golden cross" (all on the S&P 500): the optimizer split money between three strategies that share 77–100% of their exposure, and the warning sat at the bottom of the tab. Nothing says what each strategy is *for*, what the plan actually holds today, or whether the plan fits the fall the user can stomach. A plan "involves multiple strategies" only in name.

**Personas.** The fund-manager view is built on 13F: quarter-end snapshots filed up to 45 days late, so every row says "Q2 2026". Fresher public sources exist and are not used.

## 2. Research (verified 16 October 2026)

| Source | Freshness | Notes |
| --- | --- | --- |
| EDGAR submissions API (`data.sec.gov/submissions/CIK<10 digits>.json`) | Minutes: includes acceptance time | Lists each filer's recent filings with form type. Needs a descriptive `User-Agent` (403 without); sends `access-control-allow-origin: *` but the file archive does not, so it goes through a proxy that sets the header. |
| Form 4 XML (insider and ≥10% owner trades) | Filed within 2 business days | Berkshire filed Form 4s on 21 Sep, 25 Sep, 30 Sep and 5 Oct 2026 (Lennar purchases, one filing naming both Berkshire and Warren Buffett as reporting owners). Gives code, shares, price, date and holding afterwards. |
| Schedule 13D/G XML (>5% holders) | Days | Buffett's 13G/A was filed 7 Oct 2026; Pershing Square's 13D/A on 8 Jun 2026. |
| 13F-HR | Quarterly, up to 45 days late | What the screen shows today. Kept as the "full portfolio at quarter end" context. |
| ARK daily holdings CSV (`assets.ark-funds.com/fund-documents/funds-etf-csv/...`) and `arkfunds.io/api/v2/etf/trades` | Daily | Official CSV is dated the same day; the trades API (unofficial, free) lists each day's buys and sells per fund. This is the only daily source for a fund manager. |
| House Clerk index | Daily | Already used; the screen should refresh it and say how old the data is. |

## 3. Plan builder design

A plan is a **goal** plus **sleeves**. Each sleeve is one strategy with a **role**, a **weight** and its own ETFs.

- **Roles** are derived from the rules, not typed in: *Core* (rules-based mix that is mostly stocks, held for the long term), *Tactical* (signal-driven, moves between risk and safety to cut big falls), *Diversifier* (spreads across stocks, bonds and gold). A good plan has a core and at least one other role.
- **Plan tab** (first tab of the Lab): a table of sleeves (role, strategy, what it holds today, weight, standalone CAGR / worst fall / Sharpe), editable weights that must total 100%, and the plan's combined result against the user's **fall limit** (the worst peak-to-trough drop they will accept).
- **What the plan holds today:** the sleeves' current target weights multiplied by their plan weights, shown by ETF and by asset class. This is what actually gets bought and what Paper Orders rebalances to.
- **Does it make sense?** Plain checks, each with a fix: redundant sleeves (shared exposure ≥ 60% or return correlation ≥ 0.9), a missing core or diversifier, one asset class above 60%, sleeves under 5%, and the worst fall beyond the limit.
- **Add a strategy** shows the catalog ranked by fit (fills a missing role, low overlap with the plan, robustness verdict) with the effect on the plan's worst fall before adding.
- **Build me a plan** picks a core, adds the least-overlapping sleeves for the missing roles (up to four) and sets weights to the highest growth that stays within the fall limit, or the shallowest fall if none does. It is a proposal the user can edit.
- **Up to five sleeves** (was three). The optimizer's grid coarsens with more sleeves so the search stays fast.
- **Copilot** (level 1): "build me a balanced plan" proposes sleeves and weights as a card that applies only on click.

## 4. Live personas design

- **EDGAR live feed.** Each persona gets SEC identities (the firm and, where it differs, the person). A "Latest filings" feed shows Form 3/4/5, Schedule 13D/G and 13F filings accepted in the last 120 days with the **acceptance time**, the lag from the trade, and the parsed details, newest first. The timeline sorts by filing time, not quarter.
- **Freshness is visible.** Each persona card says when it last checked, how long ago its newest filing was accepted, and flags filings that arrived since the user last looked. The screen re-checks every 5 minutes while open (the submissions list is small and the SEC allows modest polling with a User-Agent).
- **ARK daily trades** for Cathie Wood: today's buys and sells per ARK fund from the trades feed, with the official holdings CSV as the cross-check, labelled as a third-party feed.
- **13F stays**, relabelled "Quarter-end portfolio (filed up to 45 days late)", beneath the live feed.
- **Honest limits:** funds without Form 4 or 13D/G activity (most hedge funds) have nothing newer than their 13F; the card says so instead of showing an old quarter as current.

## 5. Delivery status

| Track | Status |
| --- | --- |
| A — Plan builder | Engine and Plan tab delivered (roles, holdings today, sense checks, add a strategy, build me a plan, five strategies, fall limit); Copilot proposal not started |
| B — Live personas | Not started |
