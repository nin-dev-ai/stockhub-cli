import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_LAB, type LabInputs } from "@/quant/lab";
import type { Weights } from "@/quant/portfolio";

interface LabState {
  inputs: LabInputs;
  /** User-chosen weights that replace the optimizer's proposal; null means use the proposal. */
  override: Weights | null;
  setInputs: (p: Partial<LabInputs>) => void;
  setOverride: (w: Weights | null) => void;
  reset: () => void;
}

export const useLab = create<LabState>()(
  persist(
    (set, get) => ({
      inputs: DEFAULT_LAB,
      override: null,
      setInputs: (p) => set({ inputs: { ...get().inputs, ...p } }),
      setOverride: (w) => set({ override: w }),
      reset: () => set({ inputs: DEFAULT_LAB, override: null }),
    }),
    { name: "stockhub-lab", merge: (saved, cur) => ({ ...cur, ...(saved as object), inputs: { ...DEFAULT_LAB, ...((saved as { inputs?: object })?.inputs ?? {}) } }) },
  ),
);
