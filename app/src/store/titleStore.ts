import { create } from "zustand";

/** Counts each watcher wants in the tab title; the title shows their sum. */
export const useTitleCounts = create<{ counts: Record<string, number>; setCount: (source: string, n: number) => void }>()((set, get) => ({
  counts: {},
  setCount: (source, n) => { if (get().counts[source] !== n) set({ counts: { ...get().counts, [source]: n } }); },
}));
