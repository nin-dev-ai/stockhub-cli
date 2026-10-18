import { describe, expect, it } from "vitest";
import { planTodo } from "./planTodo";
import { finalizeTx, type Portfolio, type TxDraft } from "./tracking";
import type { Panel } from "./types";

let seq = 0;
const tx = (d: TxDraft) => finalizeTx(d, `t${++seq}`, "2026-01-01T00:00:00Z");
const panel: Panel = {
  dates: ["2026-09-30", "2026-10-01", "2026-11-02", "2026-11-03"],
  closes: { SPY: [100, 100, 100, 100], SHY: [50, 50, 50, 50] },
};
const original = { asOf: "2026-09-30", weights: { trend: 1 }, inputs: { rebalance: "quarterly", monthly: 50, fixedFee: 0 } } as never;
const run = (decisions: { date: string; targets: Record<string, number> }[]) => ({
  strategy: { id: "trend", name: "200-day moving average filter" },
  run: { decisions: decisions.map((d) => ({ ...d, kind: "rebalance", reason: "" })) },
}) as never;
const portfolio = (extra: TxDraft[] = []): Portfolio => ({
  id: "pf1", name: "Balanced plan", mode: "paper", baseCurrency: "USD", createdAt: "x", snapshotIds: ["s1"],
  transactions: [
    tx({ date: "2026-09-30", kind: "contribution", amount: 1000, fee: 0 }),
    tx({ date: "2026-09-30", kind: "buy", ticker: "SPY", units: 10, price: 100, fee: 0 }),
    ...extra.map(tx),
  ],
});

describe("what needs doing", () => {
  it("reports a signal switch after the last trade, a drift, a due rebalance and a due contribution", () => {
    const items = planTodo({
      portfolio: portfolio(), original, targets: { SHY: 1 }, panel,
      results: [run([{ date: "2026-09-30", targets: { SPY: 1 } }, { date: "2026-10-01", targets: { SPY: 1 } }, { date: "2026-11-02", targets: { SHY: 1 } }])],
    });
    expect(items.map((i) => i.kind)).toEqual(["switch", "drift", "rebalance", "contribution"]);
    expect(items[0].title).toBe("200-day moving average filter moved from SPY to SHY");
    expect(items[0].key).toBe("pf1:switch:trend:2026-11-02");
    expect(items[1].title).toMatch(/^(SPY is 100\.0 points above|SHY is 100\.0 points below) its target \(2 holdings past 5 points\)$/);
    expect(items[2].key).toBe("pf1:rebalance:2026Q4");
    expect(items[3].title).toBe("The $50 monthly contribution for 2026-11 is due");
  });
  it("is quiet when the plan is followed: holdings on target, rebalanced and contributed this period", () => {
    const items = planTodo({
      portfolio: portfolio([{ date: "2026-11-02", kind: "contribution", amount: 50, fee: 0 }, { date: "2026-11-02", kind: "buy", ticker: "SPY", units: 0.5, price: 100, fee: 0 }]),
      original, targets: { SPY: 1 }, panel,
      results: [run([{ date: "2026-09-30", targets: { SPY: 1 } }, { date: "2026-11-02", targets: { SPY: 1 } }])],
    });
    expect(items).toEqual([]);
  });
  it("ignores switches the portfolio already traded on", () => {
    const items = planTodo({
      portfolio: portfolio([{ date: "2026-11-03", kind: "sell", ticker: "SPY", units: 10, price: 100, fee: 0 }, { date: "2026-11-03", kind: "buy", ticker: "SHY", units: 20, price: 50, fee: 0 }]),
      original, targets: { SHY: 1 }, panel,
      results: [run([{ date: "2026-09-30", targets: { SPY: 1 } }, { date: "2026-11-02", targets: { SHY: 1 } }])],
    });
    expect(items.map((i) => i.kind)).toEqual(["contribution"]);
  });
});
