import { describe, it, expect } from "vitest";
import { entryDay, sinceTrade, tradeKey } from "./sinceTrade";
import type { PersonaTrade } from "./personas";
import type { RawBar } from "./data";

const days = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"];
const bars = (closes: number[]): RawBar[] => days.map((date, i) => ({ date, close: closes[i] }));
const spy = bars([100, 101, 102, 103, 104, 105]);
const t = (o: Partial<PersonaTrade>): PersonaTrade => ({ date: "2026-10-01", filed: null, symbol: "LEN", asset: "Lennar", side: "buy", action: "Open-market purchase", shares: 100, price: 80, value: 8000, detail: "", url: null, ...o });

describe("results since a trade became public", () => {
  it("enters at the first close a follower could trade at", () => {
    expect(entryDay(t({ accepted: "2026-10-06T05:02:56Z" }))).toEqual({ date: "2026-10-06", sameDay: true });
    expect(entryDay(t({ accepted: "2026-10-05T21:30:00Z" }))).toEqual({ date: "2026-10-05", sameDay: false });
    expect(entryDay(t({ filed: "2026-10-02" }))).toEqual({ date: "2026-10-02", sameDay: false });
    expect(entryDay(t({ form: "ARK daily", date: "2026-10-02", filed: "2026-10-02" }))).toEqual({ date: "2026-10-02", sameDay: false });
    expect(entryDay(t({ filed: null, accepted: undefined }))).toBeNull();
  });
  it("measures the stock against SPY from that close to the latest, and scores buys and sales", () => {
    const len = bars([80, 80, 80, 90, 95, 99]);
    const r = sinceTrade([
      t({ accepted: "2026-10-06T05:02:56Z" }),            // enters 10-06 at 90 → 99: +10%; SPY 103 → 105
      t({ side: "sell", action: "Open-market sale", accepted: "2026-10-05T21:30:00Z" }), // after the close: enters 10-06 too
      t({ symbol: "NONE", accepted: "2026-10-06T05:02:56Z" }),
      t({ filed: null, accepted: undefined }),
      t({ side: "other", action: "Gift", accepted: "2026-10-06T05:02:56Z" }),
    ], { LEN: len }, spy);
    expect(r.rows).toHaveLength(2);
    const buy = r.rows[0];
    expect(buy).toMatchObject({ entry: "2026-10-06", exit: "2026-10-08", side: "buy", days: 2 });
    expect(buy.ret).toBeCloseTo(0.1, 12);
    expect(buy.spyRet).toBeCloseTo(105 / 103 - 1, 12);
    expect(buy.hit).toBe(true);
    expect(r.rows[1]).toMatchObject({ side: "sell", entry: "2026-10-06", hit: false });
    expect(r.summary).toMatchObject({ buys: 1, sells: 1, hitRate: 0.5, skipped: 2 });
    expect(r.summary.avgBuyExcess).toBeCloseTo(0.1 - (105 / 103 - 1), 12);
  });
  it("skips trades that became public on the last day, with nothing to measure yet", () => {
    const r = sinceTrade([t({ accepted: "2026-10-08T05:00:00Z" })], { LEN: bars([1, 1, 1, 1, 1, 1]) }, spy);
    expect(r.rows).toEqual([]);
    expect(r.summary.skipped).toBe(1);
    expect(tradeKey(t({}))).toBe(tradeKey(t({})));
  });
});
