/** Aligned daily panel of dividend-adjusted closes. Every series has dates.length entries. */
export interface Panel {
  dates: string[];                    // ascending ISO dates (YYYY-MM-DD)
  closes: Record<string, number[]>;   // ticker -> adjusted close
}

export type Severity = "info" | "warn" | "error";
export interface QualityFlag { code: string; severity: Severity; message: string }

export const ENGINE_VERSION = "1.0.0";
export const TRADING_DAYS = 252;

export interface Metrics {
  totalReturn: number | null;        // time-weighted, decimal
  cagr: number | null;               // needs >= 1 year
  volatility: number | null;         // annualized, needs >= MIN_OBS_RISK daily obs
  sharpe: number | null;
  sortino: number | null;
  maxDrawdown: number | null;        // negative decimal
  maxDrawdownDays: number | null;    // longest peak-to-recovery span, in observations
  bestDay: number | null;
  worstDay: number | null;
  observations: number;
  years: number;
  unavailable: Record<string, string>;
}

export const MIN_OBS_RISK = 60;
export const MIN_YEARS_CAGR = 1;
