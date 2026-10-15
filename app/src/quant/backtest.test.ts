import { describe, it, expect } from "vitest";
import { simulate, DEFAULT_CONFIG, periodKey, type RunConfig } from "./backtest";
import { validateStrategy, type StrategyDef } from "./strategy";
import { describeRules } from "./rules";
import type { Panel } from "./types";

const NOCOST: RunConfig = { ...DEFAULT_CONFIG, initial: 1000, costs: { commissionBps: 0, slippageBps: 0, fixedFee: 0 } };

const def = (over: Partial<StrategyDef>): StrategyDef => ({
  schema: 1, id: "test_strategy", version: 1, name: "Test strategy", summary: "", intendedUse: "", tags: [],
  region: "US", holdingPeriod: "", universe: ["SPY"], benchmark: "SPY",
  allocation: { type: "static", weights: { SPY: 1 } }, rebalance: { schedule: "none" },
  methodology: "", caveats: [], evidence: "Backtested", ...over,
});

const bdays = (start: string, n: number): string[] => {
  const out: string[] = []; let t = Date.parse(start);
  while (out.length < n) { const d = new Date(t); t += 864e5; if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10)); }
  return out;
};
const panel = (closes: Record<string, number[]>, start = "2024-01-02"): Panel => {
  const n = Object.values(closes)[0].length;
  return { dates: bdays(start, n), closes };
};

describe("fills and timing", () => {
  it("buys at the NEXT close, not the decision close (no look-ahead)", () => {
    const r = simulate(def({}), panel({ SPY: [100, 200, 200] }), NOCOST);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].price).toBe(200);
    expect(r.trades[0].shares).toBeCloseTo(5);
    expect(r.finalValue).toBeCloseTo(1000);
    expect(r.trades[0].decisionDate).toBe("2024-01-02");
    expect(r.trades[0].date).toBe("2024-01-03");
  });

  it("compounds a buy-and-hold correctly", () => {
    const r = simulate(def({}), panel({ SPY: [100, 100, 110, 121] }), NOCOST);
    expect(r.equity.map((v) => +v.toFixed(2))).toEqual([1000, 1000, 1100, 1210]);
    expect(r.returns.map((v) => +v.toFixed(4))).toEqual([0, 0.1, 0.1]);
    expect(r.metrics.totalReturn).toBeCloseTo(0.21);
  });

  it("prices after a decision cannot change that decision (property)", () => {
    const base = [10, 11, 12, 13, 12, 9, 8, 8, 8, 9, 10, 11];
    const d = def({ universe: ["A", "S"], benchmark: "A", allocation: { type: "trend", risky: "A", safe: "S", smaDays: 3, bandPct: 0 }, rebalance: { schedule: "daily" } });
    const flat = new Array(base.length).fill(100);
    const k = 5;
    const altered = base.map((v, i) => (i >= k + 2 ? v * 3 + 7 : v));
    const a = simulate(d, panel({ A: base, S: flat }), NOCOST);
    const b = simulate(d, panel({ A: altered, S: flat }), NOCOST);
    const cut = a.dates[k + 1];
    const upTo = (r: typeof a) => r.trades.filter((t) => t.date <= cut).map((t) => [t.date, t.ticker, t.side, t.shares]);
    expect(upTo(a)).toEqual(upTo(b));
    expect(a.decisions.filter((x) => x.date <= a.dates[k])).toEqual(b.decisions.filter((x) => x.date <= a.dates[k]));
  });
});

describe("costs", () => {
  it("deducts slippage and commission so that a flat market loses exactly the costs", () => {
    const cfg: RunConfig = { ...DEFAULT_CONFIG, initial: 1000, costs: { commissionBps: 10, slippageBps: 100, fixedFee: 0 } };
    const r = simulate(def({}), panel({ SPY: [100, 100, 100, 100] }), cfg);
    expect(r.costsPaid).toBeGreaterThan(10);
    expect(r.gain).toBeCloseTo(-r.costsPaid, 6);
    expect(r.trades[0].price).toBeCloseTo(101);
  });

  it("charges a fixed fee per trade and never spends more cash than exists", () => {
    const cfg: RunConfig = { ...NOCOST, initial: 200, costs: { commissionBps: 0, slippageBps: 0, fixedFee: 5 } };
    const r = simulate(def({}), panel({ SPY: [100, 100, 100] }), cfg);
    expect(r.costsPaid).toBeCloseTo(5);
    expect(r.finalValue).toBeCloseTo(195);
  });

  it("whole-share mode buys integer shares and leaves the remainder in cash", () => {
    const r = simulate(def({}), panel({ SPY: [100, 130, 130] }), { ...NOCOST, initial: 1000, fractional: false });
    expect(r.trades[0].shares).toBe(7);
    expect(r.finalValue).toBeCloseTo(1000);
    expect(r.avgExposure.CASH).toBeCloseTo((1 + 0.09 + 0.09) / 3, 3);
  });
});

describe("contributions", () => {
  const monthly: RunConfig = { ...NOCOST, initial: 1000, contribution: { amount: 100, frequency: "monthly" } };
  const p = panel({ SPY: new Array(65).fill(100) }, "2024-01-02");

  it("credits on the first trading day of each new month, not on day 0", () => {
    const r = simulate(def({}), p, monthly);
    const months = new Set(p.dates.map((d) => d.slice(0, 7))).size;
    expect(r.totalContributed).toBe(1000 + 100 * (months - 1));
    const jump = r.invested.findIndex((v, i) => i > 0 && v > r.invested[i - 1]);
    expect(p.dates[jump].slice(5, 7)).toBe("02");
  });

  it("time-weighted returns ignore contributions entirely", () => {
    const r = simulate(def({}), p, monthly);
    expect(r.returns.every((x) => Math.abs(x) < 1e-12)).toBe(true);
    expect(r.metrics.totalReturn).toBeCloseTo(0);
  });

  it("invests new cash without selling existing holdings", () => {
    const r = simulate(def({}), p, monthly);
    expect(r.trades.every((t) => t.side === "buy")).toBe(true);
    expect(r.trades.length).toBeGreaterThan(2);
  });

  it("supports USD 200 initial and USD 50/month for five years without assuming extra capital", () => {
    const n = 252 * 5;
    const closes = Array.from({ length: n }, (_, i) => 100 * 1.0003 ** i);
    const cfg: RunConfig = { ...DEFAULT_CONFIG, initial: 200, contribution: { amount: 50, frequency: "monthly" } };
    const r = simulate(def({}), panel({ SPY: closes }), cfg);
    const months = new Set(bdays("2024-01-02", n).map((d) => d.slice(0, 7))).size;
    expect(r.totalContributed).toBe(200 + 50 * (months - 1));
    expect(r.equity.every((v, i) => v <= r.invested[i] * 3)).toBe(true);
    for (const t of r.trades) expect(t.notional).toBeLessThanOrEqual(r.invested[r.dates.indexOf(t.date)] + 1e-6);
  });
});

describe("static allocation and rebalancing", () => {
  const two = (schedule: StrategyDef["rebalance"]) => def({
    universe: ["A", "B"], benchmark: "A", allocation: { type: "static", weights: { A: 0.5, B: 0.5 } }, rebalance: schedule,
  });
  const a = Array.from({ length: 70 }, (_, i) => 100 * 1.01 ** i), b = new Array(70).fill(100);

  it("starts at the target weights", () => {
    const r = simulate(two({ schedule: "none" }), panel({ A: a, B: b }), NOCOST);
    const buys = r.trades.filter((t) => t.date === r.dates[1]);
    expect(buys.map((t) => t.ticker).sort()).toEqual(["A", "B"]);
    expect(buys[0].notional).toBeCloseTo(500);
  });

  it("monthly rebalance sells the winner and buys the laggard after the month starts", () => {
    const r = simulate(two({ schedule: "monthly" }), panel({ A: a, B: b }), NOCOST);
    const later = r.trades.filter((t) => t.date > r.dates[1]);
    expect(later.some((t) => t.ticker === "A" && t.side === "sell")).toBe(true);
    expect(later.some((t) => t.ticker === "B" && t.side === "buy")).toBe(true);
    const first = r.decisions.find((d) => d.date > r.dates[0])!;
    expect(first.date.slice(5, 7)).toBe("02");
  });

  it("threshold rebalance only trades when drift exceeds the threshold", () => {
    const r = simulate(two({ schedule: "none", thresholdPct: 0.05 }), panel({ A: a, B: b }), NOCOST);
    const rebalances = r.decisions.filter((d) => d.kind === "rebalance");
    expect(rebalances.length).toBeGreaterThan(1);
    expect(rebalances.slice(1).every((d) => /Drift/.test(d.reason))).toBe(true);
    const tight = simulate(two({ schedule: "none", thresholdPct: 0.4 }), panel({ A: a, B: b }), NOCOST);
    expect(tight.decisions.filter((d) => d.kind === "rebalance").length).toBeLessThan(rebalances.length);
  });

  it("with no rebalancing, holdings drift with the market", () => {
    const r = simulate(two({ schedule: "none" }), panel({ A: a, B: b }), NOCOST);
    expect(r.trades).toHaveLength(2);
    expect(r.finalValue).toBeCloseTo(500 * (a[69] / a[1]) + 500, 4);
  });
});

describe("trend filter", () => {
  const A = [10, 11, 12, 13, 12, 9, 8, 8, 8], S = new Array(9).fill(100);
  const d = def({ universe: ["A", "S"], benchmark: "A", allocation: { type: "trend", risky: "A", safe: "S", smaDays: 3, bandPct: 0 }, rebalance: { schedule: "daily" } });

  it("holds safe during warm-up, switches on the crossing, and fills one day later", () => {
    const r = simulate(d, panel({ A, S }), NOCOST);
    const dates = r.dates;
    const sig = r.trades.map((t) => `${t.date}:${t.side}:${t.ticker}`);
    expect(sig).toEqual([
      `${dates[1]}:buy:S`,
      `${dates[3]}:sell:S`, `${dates[3]}:buy:A`,
      `${dates[5]}:sell:A`, `${dates[5]}:buy:S`,
    ]);
    expect(r.trades[1].reason).toMatch(/risk-on/);
    expect(r.trades[3].reason).toMatch(/risk-off/);
    expect(r.trades[0].reason).toMatch(/Warm-up|Initial/);
  });

  it("a hysteresis band suppresses whipsaw trades", () => {
    const wiggle = [10, 10, 10, 10.1, 9.95, 10.1, 9.95, 10.1, 9.95, 10.1, 9.95, 10.1];
    const flat = new Array(wiggle.length).fill(100);
    const run = (band: number) => simulate(
      def({ universe: ["A", "S"], benchmark: "A", allocation: { type: "trend", risky: "A", safe: "S", smaDays: 3, bandPct: band }, rebalance: { schedule: "daily" } }),
      panel({ A: wiggle, S: flat }), NOCOST).tradeCount;
    expect(run(0.03)).toBeLessThan(run(0));
  });
});

describe("DCA and reserve (locked cash)", () => {
  it("DCA deploys the initial capital in equal monthly tranches", () => {
    const p = panel({ SPY: new Array(100).fill(100) });
    const r = simulate(def({ entry: { deployMonths: 3 } }), p, { ...NOCOST, initial: 3000 });
    const buys = r.trades.filter((t) => t.side === "buy");
    expect(buys).toHaveLength(3);
    for (const b of buys) expect(b.notional).toBeCloseTo(1000);
    expect(buys[0].reason).toMatch(/tranche 1\/3/);
    expect(buys[2].reason).toMatch(/tranche 3\/3/);
    expect(buys[1].date.slice(5, 7)).toBe("02");
  });

  it("DCA beats lump sum in a falling market and trails it in a rising one", () => {
    const n = 120;
    const rising = Array.from({ length: n }, (_, i) => 100 * 1.004 ** i);
    const falling = Array.from({ length: n }, (_, i) => 100 * 0.996 ** i);
    const cfg = { ...NOCOST, initial: 3000 };
    const final = (c: number[], e?: StrategyDef["entry"]) => simulate(def({ entry: e }), panel({ SPY: c }), cfg).finalValue;
    expect(final(rising, { deployMonths: 3 })).toBeLessThan(final(rising));
    expect(final(falling, { deployMonths: 3 })).toBeGreaterThan(final(falling));
  });

  it("holds back part of each contribution and releases it after a deep drawdown", () => {
    const closes = [...new Array(70).fill(100), ...Array.from({ length: 30 }, (_, i) => 100 - i * 1.5)];
    const d = def({ reserve: { fraction: 0.5, riskyTicker: "SPY", releaseDrawdown: -0.1 } });
    const cfg: RunConfig = { ...NOCOST, initial: 1000, contribution: { amount: 100, frequency: "monthly" } };
    const r = simulate(d, panel({ SPY: closes }), cfg);
    const released = r.trades.filter((t) => /release reserve/.test(t.reason));
    expect(released.length).toBeGreaterThan(0);
    const dd = closes[r.dates.indexOf(released[0].decisionDate)] / 100 - 1;
    expect(dd).toBeLessThanOrEqual(-0.1);
    const before = r.trades.filter((t) => t.date < released[0].date && t.side === "buy" && t.date > r.dates[1]);
    for (const b of before) expect(b.notional).toBeCloseTo(50, 4);
  });
});

describe("conservation and metrics", () => {
  it("in a flat market with no costs equity equals money invested", () => {
    const cfg: RunConfig = { ...NOCOST, initial: 500, contribution: { amount: 75, frequency: "weekly" } };
    const r = simulate(def({ universe: ["A", "B"], benchmark: "A", allocation: { type: "static", weights: { A: 0.7, B: 0.3 } }, rebalance: { schedule: "monthly" } }),
      panel({ A: new Array(80).fill(50), B: new Array(80).fill(20) }), cfg);
    r.equity.forEach((v, i) => expect(v).toBeCloseTo(r.invested[i], 6));
  });

  it("rejects an unrunnable setup instead of returning zeros", () => {
    const r = simulate(def({}), panel({ SPY: [100, 101] }), { ...NOCOST, initial: 0 });
    expect(r.flags[0].code).toBe("no_run");
    expect(simulate(def({}), panel({ SPY: [100] }), NOCOST).flags[0].code).toBe("no_run");
  });

  it("money-weighted return is close to the time-weighted return with a single deposit", () => {
    const closes = Array.from({ length: 600 }, (_, i) => 100 * 1.0004 ** i);
    const r = simulate(def({}), panel({ SPY: closes }), NOCOST);
    expect(r.moneyWeightedReturn).not.toBeNull();
    expect(r.moneyWeightedReturn!).toBeCloseTo(r.metrics.cagr!, 2);
  });

  it("is deterministic", () => {
    const p = panel({ SPY: Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 7) * 10) });
    expect(simulate(def({}), p, NOCOST)).toEqual(simulate(def({}), p, NOCOST));
  });
});

describe("other allocations", () => {
  it("momentum picks the strongest asset and falls back to safe on negative momentum", () => {
    const up = Array.from({ length: 60 }, (_, i) => 100 * 1.01 ** i);
    const down = Array.from({ length: 60 }, (_, i) => 100 * 0.99 ** i);
    const flat = new Array(60).fill(100);
    const d = def({ universe: ["U", "D"], benchmark: "U", allocation: { type: "momentum", universe: ["U", "D"], lookbackDays: 20, topN: 2, safe: "S", absoluteFilter: true }, rebalance: { schedule: "monthly" } });
    const r = simulate(d, panel({ U: up, D: down, S: flat }), NOCOST);
    const late = r.decisions[r.decisions.length - 1].targets;
    expect(late.U).toBeCloseTo(0.5);
    expect(late.S).toBeCloseTo(0.5);
    expect(late.D).toBeUndefined();
  });

  it("vol targeting never exceeds 100% risky and lowers exposure when volatility is high", () => {
    const calm = Array.from({ length: 100 }, (_, i) => 100 * 1.0005 ** i);
    const wild = Array.from({ length: 100 }, (_, i) => 100 * (i % 2 ? 1.04 : 0.96) ** 1 * (1 + i / 1000));
    const d = def({ universe: ["R", "S"], benchmark: "R", allocation: { type: "vol_target", risky: "R", safe: "S", targetVol: 0.1, lookbackDays: 20 }, rebalance: { schedule: "weekly", minTradeWeight: 0.02 } });
    const flat = new Array(100).fill(100);
    const rc = simulate(d, panel({ R: calm, S: flat }), NOCOST);
    const rw = simulate(d, panel({ R: wild, S: flat }), NOCOST);
    for (const dec of [...rc.decisions, ...rw.decisions]) expect(dec.targets.R ?? 0).toBeLessThanOrEqual(1 + 1e-12);
    expect(rw.avgExposure.R ?? 0).toBeLessThan(rc.avgExposure.R ?? 1);
  });

  it("seasonal holds risk only in the listed months", () => {
    const d = def({ universe: ["R", "S"], benchmark: "R", allocation: { type: "seasonal", risky: "R", safe: "S", riskyMonths: [1, 2] }, rebalance: { schedule: "daily" } });
    const p = panel({ R: new Array(150).fill(100), S: new Array(150).fill(100) });
    const r = simulate(d, p, NOCOST);
    expect(r.decisions.some((x) => x.targets.R === 1 && /Month 1|Month 2/.test(x.reason))).toBe(true);
    expect(r.decisions.some((x) => x.targets.S === 1 && /risk-off/.test(x.reason))).toBe(true);
  });

  it("tsmom holds risk after a positive trailing return only", () => {
    const d = def({ universe: ["R", "S"], benchmark: "R", allocation: { type: "tsmom", risky: "R", safe: "S", lookbackDays: 10 }, rebalance: { schedule: "daily" } });
    const R = [...Array.from({ length: 30 }, (_, i) => 100 + i), ...Array.from({ length: 30 }, (_, i) => 130 - i * 2)];
    const r = simulate(d, panel({ R, S: new Array(60).fill(100) }), NOCOST);
    expect(r.decisions.some((x) => x.targets.R === 1)).toBe(true);
    expect(r.decisions[r.decisions.length - 1].targets.S).toBe(1);
  });
});

describe("periodKey", () => {
  it("changes at the right boundaries", () => {
    expect(periodKey("2024-03-31", "monthly")).not.toBe(periodKey("2024-04-01", "monthly"));
    expect(periodKey("2024-03-31", "quarterly")).not.toBe(periodKey("2024-04-01", "quarterly"));
    expect(periodKey("2024-02-01", "quarterly")).toBe(periodKey("2024-03-29", "quarterly"));
    expect(periodKey("2024-12-31", "annual")).not.toBe(periodKey("2025-01-02", "annual"));
    expect(periodKey("2024-01-05", "weekly")).not.toBe(periodKey("2024-01-08", "weekly")); // Fri vs Mon
    expect(periodKey("2024-01-08", "weekly")).toBe(periodKey("2024-01-12", "weekly"));
  });
});

describe("validateStrategy", () => {
  it("accepts a valid definition", () => {
    expect(validateStrategy(def({})).ok).toBe(true);
  });
  it("rejects leverage, bad weights, unknown tickers and out-of-range parameters", () => {
    const bad = (o: Partial<StrategyDef>) => validateStrategy(def(o)).errors.join(" | ");
    expect(bad({ allocation: { type: "static", weights: { SPY: 0.7, AGG: 0.7 } } })).toMatch(/sum to 100%/);
    expect(bad({ allocation: { type: "static", weights: { SPY: 1.5, AGG: -0.5 } } })).toMatch(/long-only/);
    expect(bad({ allocation: { type: "static", weights: { AAPL: 1 } } })).toMatch(/not a supported/);
    expect(bad({ allocation: { type: "trend", risky: "SPY", safe: "SHY", smaDays: 1, bandPct: 0 } })).toMatch(/smaDays/);
    expect(bad({ allocation: { type: "vol_target", risky: "SPY", safe: "SHY", targetVol: 0.8, lookbackDays: 20 } })).toMatch(/targetVol/);
    expect(bad({ rebalance: { schedule: "hourly" as never } })).toMatch(/schedule/);
    expect(bad({ reserve: { fraction: 2, riskyTicker: "SPY", releaseDrawdown: 0.1 } })).toMatch(/reserve/);
    expect(validateStrategy(null).ok).toBe(false);
  });
});

describe("describeRules", () => {
  it("states the timing convention and the specific parameters", () => {
    const text = describeRules(def({ allocation: { type: "trend", risky: "SPY", safe: "SHY", smaDays: 200, bandPct: 0.01 }, rebalance: { schedule: "daily" } })).join(" ");
    expect(text).toMatch(/200-day/);
    expect(text).toMatch(/next trading day's close/);
    expect(text).toMatch(/1\.0%/);
  });
});
