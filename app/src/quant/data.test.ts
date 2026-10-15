import { describe, it, expect } from "vitest";
import { buildDataset, cleanSeries, slicePanel, subPanel, hasErrors, type RawBar } from "./data";
import { instrumentFor, INSTRUMENTS } from "./instruments";

const days = (start: string, n: number, f = (i: number) => 100 + i): RawBar[] => {
  const out: RawBar[] = [];
  let t = Date.parse(start), i = 0;
  while (out.length < n) {
    const d = new Date(t); t += 864e5;
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    out.push({ date: d.toISOString().slice(0, 10), close: f(i++) });
  }
  return out;
};
const meta = { provider: "test", fetchedAt: "2024-06-01T00:00:00Z" };

describe("cleanSeries", () => {
  it("drops bad prices, de-duplicates and sorts", () => {
    const { bars, dropped } = cleanSeries([
      { date: "2024-01-03", close: 3 }, { date: "2024-01-02", close: 2 },
      { date: "2024-01-02", close: 2.5 }, { date: "2024-01-04", close: NaN },
      { date: "2024-01-05", close: 0 }, { date: "2024-01-06", close: -1 },
    ]);
    expect(bars).toEqual([{ date: "2024-01-02", close: 2.5 }, { date: "2024-01-03", close: 3 }]);
    expect(dropped).toBe(3);
  });
});

describe("buildDataset", () => {
  it("aligns tickers on the intersection of dates", () => {
    const a = days("2024-01-01", 30);
    const b = a.slice(5);
    const { panel, version } = buildDataset({ A: a, B: b }, meta);
    expect(panel.dates).toEqual(b.map((x) => x.date));
    expect(panel.closes.A).toHaveLength(panel.dates.length);
    expect(panel.closes.A[0]).toBe(a[5].close);
    expect(version.start).toBe(b[0].date);
    expect(version.tickers).toEqual(["A", "B"]);
  });

  it("id is stable for identical data and changes when a price is revised", () => {
    const a = days("2023-01-02", 300);
    const v1 = buildDataset({ A: a }, meta).version.id;
    const v2 = buildDataset({ A: a.map((x) => ({ ...x })) }, { ...meta, fetchedAt: "2024-06-02T00:00:00Z" }).version.id;
    const revised = a.map((x, i) => (i === 100 ? { ...x, close: x.close + 0.01 } : x));
    expect(v1).toBe(v2);
    expect(buildDataset({ A: revised }, meta).version.id).not.toBe(v1);
  });

  it("flags short history, stale data, gaps, jumps and trimmed history", () => {
    const short = buildDataset({ A: days("2024-05-01", 20) }, meta).version.qualityFlags.map((f) => f.code);
    expect(short).toContain("short_history");

    const stale = buildDataset({ A: days("2023-01-02", 300) }, { ...meta, fetchedAt: "2025-01-01T00:00:00Z" });
    expect(stale.version.qualityFlags.map((f) => f.code)).toContain("stale");

    const gapped = [...days("2023-01-02", 100), ...days("2023-08-01", 100)];
    expect(buildDataset({ A: gapped }, meta).version.qualityFlags.map((f) => f.code)).toContain("gap");

    const jump = days("2023-01-02", 300, (i) => (i < 150 ? 100 : 300));
    expect(buildDataset({ A: jump }, meta).version.qualityFlags.map((f) => f.code)).toContain("price_jump");

    const long = days("2020-01-01", 800), young = days("2023-01-02", 300);
    expect(buildDataset({ A: long, B: young }, meta).version.qualityFlags.map((f) => f.code)).toContain("history_trimmed");
  });

  it("errors on empty or non-overlapping inputs instead of inventing a panel", () => {
    const empty = buildDataset({ A: [] }, meta);
    expect(hasErrors(empty.version.qualityFlags)).toBe(true);
    const none = buildDataset({ A: days("2020-01-01", 50), B: days("2024-01-01", 50) }, { ...meta, fetchedAt: "2024-03-01T00:00:00Z" });
    expect(none.version.qualityFlags.map((f) => f.code)).toContain("no_overlap");
    expect(none.panel.dates).toEqual([]);
  });
});

describe("panel helpers", () => {
  const { panel } = buildDataset({ A: days("2024-01-01", 20), B: days("2024-01-01", 20, (i) => 50 + i) }, meta);
  it("slices inclusively without mutating", () => {
    const s = slicePanel(panel, panel.dates[3], panel.dates[6]);
    expect(s.dates).toEqual(panel.dates.slice(3, 7));
    expect(s.closes.A).toEqual(panel.closes.A.slice(3, 7));
    expect(panel.dates).toHaveLength(20);
  });
  it("returns an empty panel for a start beyond the data", () => {
    expect(slicePanel(panel, "2030-01-01").dates).toEqual([]);
  });
  it("subPanel keeps dates and selects tickers", () => {
    expect(Object.keys(subPanel(panel, ["B"]).closes)).toEqual(["B"]);
  });
});

describe("instruments", () => {
  it("exposure vectors sum to 1", () => {
    for (const i of INSTRUMENTS) {
      expect(Object.values(i.exposure).reduce((a, b) => a + (b ?? 0), 0)).toBeCloseTo(1);
    }
  });
  it("maps an index to its investable proxy and refuses unsupported indices", () => {
    expect(instrumentFor("^GSPC")?.ticker).toBe("SPY");
    expect(instrumentFor("spy")?.ticker).toBe("SPY");
    expect(instrumentFor("^NSEI")).toBeUndefined();
    expect(instrumentFor("AAPL")).toBeUndefined();
  });
});
