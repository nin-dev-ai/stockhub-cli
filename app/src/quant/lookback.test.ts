import { describe, it, expect } from "vitest";
import { backtestConfig, DEFAULT_LAB, lookbackStart, validateLab } from "./lab";
import { runBacktestOn } from "./service";
import { CATALOG_BY_ID } from "./catalog";
import { syntheticDataset } from "./testData";
import { labChangeFromText } from "@/copilot/labChanges";
import { respond } from "@/copilot/assistant";

describe("look-back window", () => {
  it("counts back from the latest date; none means everything available", () => {
    expect(lookbackStart(10, new Date("2026-10-16T12:00:00Z"))).toBe("2016-10-16");
    expect(lookbackStart(null, new Date())).toBeUndefined();
    expect(backtestConfig({ ...DEFAULT_LAB, lookbackYears: 5 }, new Date("2026-10-16T00:00:00Z")).start).toBe("2021-10-16");
    expect(backtestConfig(DEFAULT_LAB).start).toBeUndefined();
  });
  it("shortens the backtest to the chosen window, from the same data", () => {
    const ds = syntheticDataset(15, 4);
    const end = ds.version.end;
    const all = runBacktestOn(ds, CATALOG_BY_ID.buy_hold_spy, backtestConfig(DEFAULT_LAB, new Date(end)));
    const five = runBacktestOn(ds, CATALOG_BY_ID.buy_hold_spy, backtestConfig({ ...DEFAULT_LAB, lookbackYears: 5 }, new Date(end)));
    expect(all.window.years).toBeGreaterThan(14);
    expect(five.window.years).toBeGreaterThan(4.9);
    expect(five.window.years).toBeLessThan(5.1);
    expect(five.window.end).toBe(all.window.end);
    expect(five.window.start > all.window.start).toBe(true);
  });
  it("validates the years or all available", () => {
    expect(validateLab({ ...DEFAULT_LAB, lookbackYears: 10 })).toEqual([]);
    expect(validateLab({ ...DEFAULT_LAB, lookbackYears: 0 }).join()).toMatch(/History to test/);
    expect(validateLab({ ...DEFAULT_LAB, lookbackYears: 31 }).join()).toMatch(/History to test/);
    expect(validateLab({ ...DEFAULT_LAB, lookbackYears: NaN }).join()).toMatch(/History to test/);
  });
});

describe("Copilot reads the look-back apart from the horizon", () => {
  it("tells 'the last 10 years' (history) from 'for 5 years' (projection)", () => {
    expect(labChangeFromText("test the last 10 years and project 5 years").change).toEqual({ lookbackYears: 10, years: 5 });
    expect(labChangeFromText("use 15 years of history").change).toEqual({ lookbackYears: 15 });
    expect(labChangeFromText("look back 8 years").change).toEqual({ lookbackYears: 8 });
    expect(labChangeFromText("run it for 20 years").change).toEqual({ years: 20 });
    expect(labChangeFromText("use all available history").change).toEqual({ lookbackYears: null });
    expect(labChangeFromText("test the last 10 years").change).toEqual({ lookbackYears: 10 });
    expect(labChangeFromText("backtest the past 7 years with $300 a month for 12 years").change).toEqual({ lookbackYears: 7, monthly: 300, years: 12 });
  });
  it("proposes it as a Lab change, refusing out-of-range values", () => {
    const a = respond("backtest the last 10 years and project 5 years", { screen: null, strategy: null, lab: null, portfolio: null });
    expect(a.kind).toBe("lab_change");
    expect(a.labChange).toEqual({ lookbackYears: 10, years: 5 });
    expect(JSON.stringify(a.blocks)).toMatch(/the last 10 years/);
    expect(respond("test the last 10 years", { screen: null, strategy: null, lab: null, portfolio: null }).kind).toBe("lab_change");
    const bad = respond("test the last 40 years of history", { screen: null, strategy: null, lab: null, portfolio: null });
    expect(bad.labChange).toBeUndefined();
    expect(JSON.stringify(bad.blocks)).toMatch(/outside the allowed range/);
  });
});
