import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CATALOG } from "@/quant/catalog";
import type { StrategyDef } from "@/quant/strategy";

export const MAX_BASKET = 3;

interface StrategyState {
  basket: string[];
  drafts: StrategyDef[];
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
