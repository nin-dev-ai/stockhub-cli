// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { useStrategies, MAX_BASKET, allStrategies, findStrategy, isDraft } from "./strategyStore";
import { CATALOG } from "@/quant/catalog";
import { forkStrategy } from "@/quant/strategy";

beforeEach(() => useStrategies.setState({ basket: [], drafts: [] }));

describe("strategy basket", () => {
  it("accepts up to three strategies and rejects a fourth with a message", () => {
    const s = useStrategies.getState();
    expect(s.addToBasket(CATALOG[0].id)).toBeNull();
    expect(s.addToBasket(CATALOG[1].id)).toBeNull();
    expect(s.addToBasket(CATALOG[2].id)).toBeNull();
    const msg = useStrategies.getState().addToBasket(CATALOG[3].id);
    expect(msg).toMatch(new RegExp(`at most ${MAX_BASKET}`));
    expect(useStrategies.getState().basket).toHaveLength(3);
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
