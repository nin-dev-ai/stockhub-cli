import { describe, it, expect } from "vitest";
import { alertText, batchNotifications, newAlerts, titleWithCount } from "./alerts";
import type { PersonaTrade } from "./personas";

const row = (o: Partial<PersonaTrade>): PersonaTrade => ({ date: "2026-10-01", filed: "2026-10-05", symbol: "LEN", asset: "LENNAR CORP · Class A", side: "buy", action: "Open-market purchase", shares: 1000, price: 80, value: 80_000_000, detail: "", url: "u1", accepted: "2026-10-06T05:02:56Z", form: "4", ...o });

describe("alerts for new filings", () => {
  it("announces filings accepted after the last look, one per filing, never twice", () => {
    const events = [row({}), row({ value: 54_900_000 }), row({ url: "u2", accepted: "2026-10-08T05:47:30Z", form: "SCHEDULE 13G/A", category: "stake", side: "other", action: "Stake report (13G amendment 1)", symbol: null, value: null, detail: "12.5% of the class · 26,034,436 shares" }), row({ url: "old", accepted: "2026-09-01T00:00:00Z" })];
    const a = newAlerts("buffett", "Warren Buffett", events, "2026-10-01T00:00:00Z", new Set());
    expect(a.map((x) => x.key)).toEqual(["u2", "u1"]);
    expect(a[1]).toMatchObject({ title: "Warren Buffett: new Form 4", body: "2 transactions, latest open-market purchase of LEN ($134.9M)" });
    expect(a[0]).toMatchObject({ title: "Warren Buffett: new 13G/A", body: "stake report (13G amendment 1) in LENNAR CORP · 12.5% of the class" });
    expect(newAlerts("buffett", "Warren Buffett", events, "2026-10-01T00:00:00Z", new Set(["u1", "u2"]))).toEqual([]);
    expect(newAlerts("buffett", "Warren Buffett", events, undefined, new Set())).toEqual([]);
  });
  it("does not announce grants, tax withholding or gifts", () => {
    const quiet = [row({ url: "t", side: "other", action: "Tax withholding" }), row({ url: "g", side: "other", action: "Grant or award" })];
    expect(newAlerts("huang", "Jensen Huang", quiet, "2026-10-01T00:00:00Z", new Set())).toEqual([]);
    const mixed = [row({ url: "m", side: "other", action: "Option exercise" }), row({ url: "m", side: "sell", action: "Open-market sale", value: 1000 })];
    expect(newAlerts("huang", "Jensen Huang", mixed, "2026-10-01T00:00:00Z", new Set())[0].body).toBe("open-market sale of LEN ($1,000)");
  });
  it("shows a few notifications at once and counts the rest in one more", () => {
    const many = [1, 2, 3, 4, 5, 6].map((i) => ({ key: `k${i}`, personaId: "p", title: `t${i}`, body: "b", accepted: `2026-10-0${i}T00:00:00Z` }));
    const n = batchNotifications(many);
    expect(n).toHaveLength(5);
    expect(n[4]).toMatchObject({ title: "2 more new filings" });
    expect(batchNotifications(many.slice(0, 3))).toHaveLength(3);
  });
  it("puts the count in the tab title only when there is something new", () => {
    expect(titleWithCount("StockHub", 3)).toBe("(3) StockHub");
    expect(titleWithCount("StockHub", 0)).toBe("StockHub");
    expect(alertText("X", [row({ value: 1234 })]).body).toBe("open-market purchase of LEN ($1,234)");
  });
});
