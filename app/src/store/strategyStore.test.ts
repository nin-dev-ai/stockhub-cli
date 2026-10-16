// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { useStrategies, MAX_BASKET, allStrategies, findStrategy, isDraft, targetedStrategies, DEFAULT_TARGET } from "./strategyStore";
import { CATALOG } from "@/quant/catalog";
import { forkStrategy, retarget } from "@/quant/strategy";

beforeEach(() => useStrategies.setState({ basket: [], drafts: [], target: DEFAULT_TARGET }));

describe("strategy basket", () => {
  it("accepts up to five strategies and rejects a sixth with a message", () => {
    expect(MAX_BASKET).toBe(5);
    for (let i = 0; i < MAX_BASKET; i++) expect(useStrategies.getState().addToBasket(CATALOG[i].id)).toBeNull();
    const msg = useStrategies.getState().addToBasket(CATALOG[MAX_BASKET].id);
    expect(msg).toMatch(new RegExp(`at most ${MAX_BASKET}`));
    expect(useStrategies.getState().basket).toHaveLength(MAX_BASKET);
  });
  it("replaces the whole basket at once, refusing more than the limit", () => {
    expect(useStrategies.getState().setBasket([CATALOG[2].id, CATALOG[1].id, CATALOG[2].id])).toBeNull();
    expect(useStrategies.getState().basket).toEqual([CATALOG[2].id, CATALOG[1].id]);
    expect(useStrategies.getState().setBasket(CATALOG.slice(0, MAX_BASKET + 1).map((c) => c.id))).toMatch(/at most/);
    expect(useStrategies.getState().basket).toEqual([CATALOG[2].id, CATALOG[1].id]);
  });
  it("ignores duplicates and supports removal", () => {
    const s = useStrategies.getState();
    s.addToBasket(CATALOG[0].id); useStrategies.getState().addToBasket(CATALOG[0].id);
    expect(useStrategies.getState().basket).toEqual([CATALOG[0].id]);
    useStrategies.getState().removeFromBasket(CATALOG[0].id);
    expect(useStrategies.getState().basket).toEqual([]);
    expect(useStrategies.getState().addToBasket(CATALOG[3].id)).toBeNull();
  });
});

describe("drafts", () => {
  it("saves a fork without changing the curated original and removes it from the basket on delete", () => {
    const draft = forkStrategy(CATALOG[2], "trend_200d_spy_d1");
    useStrategies.getState().saveDraft(draft);
    useStrategies.getState().addToBasket(draft.id);
    const { drafts } = useStrategies.getState();
    expect(allStrategies(drafts)).toHaveLength(CATALOG.length + 1);
    expect(findStrategy(draft.id, drafts)?.forkOf).toBe("trend_200d_spy@1");
    expect(isDraft(draft.id)).toBe(true);
    expect(isDraft(CATALOG[2].id)).toBe(false);
    useStrategies.getState().deleteDraft(draft.id);
    expect(useStrategies.getState().basket).toEqual([]);
    expect(useStrategies.getState().drafts).toEqual([]);
    expect(CATALOG[2].name).not.toMatch(/draft/);
  });
  it("re-saving a draft with the same id replaces it", () => {
    const d = forkStrategy(CATALOG[0], "buy_hold_spy_d1");
    useStrategies.getState().saveDraft(d);
    useStrategies.getState().saveDraft({ ...d, name: "Renamed draft" });
    expect(useStrategies.getState().drafts).toHaveLength(1);
    expect(useStrategies.getState().drafts[0].name).toBe("Renamed draft");
  });
});

describe("screen-wide ETF switch", () => {
  it("is the plain catalog at the default target", () => {
    const { defs, retargeted } = targetedStrategies([], DEFAULT_TARGET);
    expect(defs).toEqual(CATALOG);
    expect(retargeted.size).toBe(0);
  });
  it("retargets only strategies that use SPY or SHY and leaves the rest unchanged", () => {
    const { defs, retargeted } = targetedStrategies([], { equity: "QQQ", defensive: "SHY" });
    expect(defs).toHaveLength(CATALOG.length);
    expect(defs.find((d) => d.id === "trend_200d_spy_on_qqq")?.benchmark).toBe("QQQ");
    expect(defs.find((d) => d.id === "three_fund")).toBe(CATALOG.find((d) => d.id === "three_fund"));
    expect(retargeted.has("three_fund")).toBe(false);
    expect(retargeted.size).toBe(CATALOG.filter((d) => d.benchmark === "SPY" && d.id !== "three_fund" && d.id !== "sector_momentum").length);
  });
  it("prefers a saved variant draft over the on-screen one and stops marking it unsaved", () => {
    const saved = { ...retarget(CATALOG.find((d) => d.id === "trend_200d_spy")!, { SPY: "QQQ" }), name: "My QQQ trend" };
    const { defs, retargeted } = targetedStrategies([saved], { equity: "QQQ", defensive: "SHY" });
    expect(defs.filter((d) => d.id === saved.id)).toEqual([saved]);
    expect(retargeted.has(saved.id)).toBe(false);
  });
  it("persists the chosen ETFs", () => {
    useStrategies.getState().setTarget({ defensive: "BIL" });
    expect(useStrategies.getState().target).toEqual({ equity: "SPY", defensive: "BIL" });
  });
});
