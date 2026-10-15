import { create } from "zustand";
import type { FunctionCode } from "@/lib/functions";
import type { LabInputs } from "@/quant/lab";
import type { OptimizationResult } from "@/quant/optimizer";
import type { Weights } from "@/quant/portfolio";
import type { ProjectionResult } from "@/quant/projection";
import type { BacktestResult } from "@/quant/service";
import type { StrategyDef } from "@/quant/strategy";
import type { Attribution, PortfolioMode } from "@/quant/tracking";
import type { Metrics } from "@/quant/types";
import type { PersonaTrade } from "@/quant/personas";

/**
 * What the Copilot may see (AI-01): structured engine outputs that screens publish. It holds
 * references to results already on screen; it never fetches or computes anything itself.
 */
export interface StrategyContext { def: StrategyDef; result: BacktestResult | null; draft: boolean }
export interface LabContext {
  inputs: LabInputs;
  weights: Weights | null;
  weightsSource: string | null;
  backtests: BacktestResult[];
  planMetrics: Metrics | null;
  optimization: OptimizationResult | null;
  projection: ProjectionResult | null;
}
export interface PortfolioContext { name: string; mode: PortfolioMode; snapshots: number; total: number | null; contributed: number | null; attribution: Attribution | null }

/** What the Personas screen has loaded for each followed persona; trades are buys and sells only. */
export interface PersonaEntry {
  id: string; name: string; role: string; kind: "fund" | "insider" | "house";
  latest: string | null; prior: string | null; holdings: number | null;
  trades: PersonaTrade[]; error: string | null; loading: boolean;
}
export interface PersonasContext { personas: PersonaEntry[] }

export interface CopilotContext {
  screen: FunctionCode | null;
  strategy: StrategyContext | null;
  lab: LabContext | null;
  portfolio: PortfolioContext | null;
  personas?: PersonasContext | null;
}

interface ContextState extends Omit<CopilotContext, "screen"> {
  setStrategy: (s: StrategyContext | null) => void;
  setLab: (l: LabContext | null) => void;
  setPortfolio: (p: PortfolioContext | null) => void;
  setPersonas: (p: PersonasContext | null) => void;
}

export const useCopilotContext = create<ContextState>()((set) => ({
  strategy: null, lab: null, portfolio: null, personas: null,
  setPersonas: (personas) => set({ personas }),
  setStrategy: (strategy) => set({ strategy }),
  setLab: (lab) => set({ lab }),
  setPortfolio: (portfolio) => set({ portfolio }),
}));
