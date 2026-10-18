import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FunctionCode } from "@/lib/functions";

export interface Tab {
  id: string;
  code: FunctionCode;
  symbol?: string;
}

interface WorkspaceState {
  tabs: Tab[];
  activeTabId: string | null;
  activeSymbol: string | null;
  openTab: (code: FunctionCode, symbol?: string) => void;
  setActiveTab: (id: string) => void;
  setActiveSymbol: (s: string) => void;
}

/** v0 kept a tab per opened screen; keep only the one that was showing. */
export function migrateWorkspace(old: unknown): WorkspaceState {
  const o = old as Partial<WorkspaceState> | undefined;
  const active = o?.tabs?.find((t) => t.id === o.activeTabId) ?? o?.tabs?.[0] ?? { id: "CC:_", code: "CC" as FunctionCode };
  return { tabs: [active], activeTabId: active.id, activeSymbol: o?.activeSymbol ?? "AAPL" } as WorkspaceState;
}

const tabId = (code: string, symbol?: string) => `${code}:${symbol ?? "_"}`;

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      tabs: [{ id: "CC:_", code: "CC" }],
      activeTabId: "CC:_",
      activeSymbol: "AAPL",
      // one screen at a time: opening a function replaces the current screen instead of adding a tab
      openTab: (code, symbol) => {
        const s = symbol?.toUpperCase();
        const id = tabId(code, s);
        set({ tabs: [{ id, code, symbol: s }], activeTabId: id, activeSymbol: s ?? get().activeSymbol });
      },
      setActiveTab: (id) => set({ activeTabId: id }),
      setActiveSymbol: (s) => set({ activeSymbol: s.toUpperCase() }),
    }),
    {
      name: "stockhub-workspace",
      version: 1,
      migrate: migrateWorkspace,
    }
  )
);
