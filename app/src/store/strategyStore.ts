import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CATALOG } from "@/quant/catalog";
import { allocationTickers, retarget, type StrategyDef } from "@/quant/strategy";

export const MAX_BASKET = 3;

/** Screen-wide ETF swap: run every strategy that uses SPY / SHY on the chosen ETFs instead. */
export interface EtfTarget { equity: string; defensive: string }
export const DEFAULT_TARGET: EtfTarget = { equity: "SPY", defensive: "SHY" };

interface StrategyState {
  basket: string[];
  drafts: StrategyDef[];
  target: EtfTarget;
  setTarget: (t: Partial<EtfTarget>) => void;
  /** Returns an error message when the add is refused. */
  addToBasket: (id: string) => string | null;
  removeFromBasket: (id: string) => void;
  clearBasket: () => void;
  saveDraft: (d: StrategyDef) => void;
  deleteDraft: (id: string) => void;
}

export const useStrategies = create<StrategyState>()(
  persist(
    (set, get) => ({
      basket: [],
      drafts: [],
      target: DEFAULT_TARGET,
      setTarget: (t) => set({ target: { ...get().target, ...t } }),
      addToBasket: (id) => {
        const { basket } = get();
        if (basket.includes(id)) return null;
        if (basket.length >= MAX_BASKET) return `The basket holds at most ${MAX_BASKET} strategies. Remove one to add another.`;
        set({ basket: [...basket, id] });
        return null;
      },
      removeFromBasket: (id) => set({ basket: get().basket.filter((b) => b !== id) }),
      clearBasket: () => set({ basket: [] }),
      saveDraft: (d) => set({ drafts: [...get().drafts.filter((x) => x.id !== d.id), d] }),
      deleteDraft: (id) => set({ drafts: get().drafts.filter((x) => x.id !== id), basket: get().basket.filter((b) => b !== id) }),
    }),
    { name: "stockhub-strategies" },
  ),
);

export const allStrategies = (drafts: StrategyDef[]): StrategyDef[] => [...CATALOG, ...drafts];
export const findStrategy = (id: string, drafts: StrategyDef[]): StrategyDef | undefined =>
  allStrategies(drafts).find((s) => s.id === id);
export const isDraft = (id: string) => !CATALOG.some((s) => s.id === id);

/**
 * The strategy list as shown on the Strategies screen: with the ETF switch at its default it is the
 * catalog plus drafts; otherwise each strategy that trades SPY or SHY is replaced by a retargeted
 * variant (saved drafts with the same id win).
 */
export function targetedStrategies(drafts: StrategyDef[], target: EtfTarget): { defs: StrategyDef[]; retargeted: Set<string> } {
  const map: Record<string, string> = { SPY: target.equity, SHY: target.defensive };
  const byId = new Map<string, StrategyDef>();
  const retargeted = new Set<string>();
  for (const d of allStrategies(drafts)) {
    // only swap ETFs the strategy trades; one that merely benchmarks against SPY is left alone
    const traded = new Set([...allocationTickers(d.allocation), ...(d.reserve ? [d.reserve.riskyTicker] : [])]);
    const r = retarget(d, Object.fromEntries(Object.entries(map).filter(([k]) => traded.has(k))));
    if (r === d) { byId.set(d.id, d); retargeted.delete(d.id); }
    else if (!byId.has(r.id)) { byId.set(r.id, r); retargeted.add(r.id); }
  }
  return { defs: [...byId.values()], retargeted };
}
