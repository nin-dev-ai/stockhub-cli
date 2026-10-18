import { describe, expect, it } from "vitest";
import { migrateWorkspace as migrate, useWorkspace } from "./workspaceStore";

describe("workspace", () => {
  it("shows one screen at a time: opening a function replaces the current one", () => {
    const { openTab } = useWorkspace.getState();
    openTab("STRAT");
    openTab("LAB");
    openTab("GP", "nvda");
    const s = useWorkspace.getState();
    expect(s.tabs).toEqual([{ id: "GP:NVDA", code: "GP", symbol: "NVDA" }]);
    expect(s.activeTabId).toBe("GP:NVDA");
    expect(s.activeSymbol).toBe("NVDA");
    openTab("PERS");
    expect(useWorkspace.getState().tabs.map((t) => t.code)).toEqual(["PERS"]);
    expect(useWorkspace.getState().activeSymbol).toBe("NVDA");
  });
  it("migrates an old multi-tab workspace to the screen that was showing", () => {
    const old = { tabs: [{ id: "CC:_", code: "CC" }, { id: "LAB:_", code: "LAB" }, { id: "PORT:_", code: "PORT" }], activeTabId: "LAB:_", activeSymbol: "MSFT" };
    expect(migrate(old)).toMatchObject({ tabs: [{ id: "LAB:_", code: "LAB" }], activeTabId: "LAB:_", activeSymbol: "MSFT" });
    expect(migrate(undefined)).toMatchObject({ tabs: [{ id: "CC:_", code: "CC" }], activeTabId: "CC:_" });
  });
});
