import { MIN_OBS_RISK, MIN_YEARS_CAGR, TRADING_DAYS, type Metrics } from "./types";

const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const stdev = (x: number[]) => {
  const m = mean(x);
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1));
};

export function yearsBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5);
}

export interface MetricOptions { riskFreeRate?: number; periodsPerYear?: number }

/**
 * `returns[i]` is the time-weighted return for dates[i+1] relative to dates[i];
 * pass dates of length returns.length + 1. Metrics that the sample cannot support
 * are null with a reason in `unavailable`, never a fabricated number.
 */
export function computeMetrics(returns: number[], dates: string[], opts: MetricOptions = {}): Metrics {
  const rf = opts.riskFreeRate ?? 0;
  const ppy = opts.periodsPerYear ?? TRADING_DAYS;
  const n = returns.length;
  const years = n > 0 ? yearsBetween(dates[0], dates[dates.length - 1]) : 0;
  const unavailable: Record<string, string> = {};
  const m: Metrics = {
    totalReturn: null, cagr: null, volatility: null, sharpe: null, sortino: null,
    maxDrawdown: null, maxDrawdownDays: null, bestDay: null, worstDay: null,
    observations: n, years, unavailable,
  };
  if (n === 0) {
    for (const k of ["totalReturn", "cagr", "volatility", "sharpe", "sortino", "maxDrawdown"]) {
      unavailable[k] = "no observations";
    }
    return m;
  }

  let growth = 1, peak = 1, dd = 0, ddStart = 0, longest = 0;
  for (let i = 0; i < n; i++) {
    growth *= 1 + returns[i];
    if (growth >= peak) { peak = growth; ddStart = i + 1; }
    dd = Math.min(dd, growth / peak - 1);
    longest = Math.max(longest, i + 1 - ddStart);
  }
  m.totalReturn = growth - 1;
  m.maxDrawdown = dd;
  m.maxDrawdownDays = longest;
  m.bestDay = Math.max(...returns);
  m.worstDay = Math.min(...returns);

  if (years >= MIN_YEARS_CAGR && growth > 0) m.cagr = growth ** (1 / years) - 1;
  else unavailable.cagr = `needs at least ${MIN_YEARS_CAGR} year of data (have ${years.toFixed(2)})`;

  if (n >= MIN_OBS_RISK) {
    const sd = stdev(returns);
    const rfp = rf / ppy;
    m.volatility = sd * Math.sqrt(ppy);
    m.sharpe = sd > 1e-12 ? ((mean(returns) - rfp) / sd) * Math.sqrt(ppy) : null;
    const downside = Math.sqrt(returns.reduce((a, r) => a + Math.min(0, r - rfp) ** 2, 0) / n);
    m.sortino = downside > 1e-12 ? ((mean(returns) - rfp) / downside) * Math.sqrt(ppy) : null;
    if (m.sharpe === null) unavailable.sharpe = "zero volatility";
    if (m.sortino === null) unavailable.sortino = "no downside observations";
  } else {
    const why = `needs at least ${MIN_OBS_RISK} observations (have ${n})`;
    unavailable.volatility = why; unavailable.sharpe = why; unavailable.sortino = why;
  }
  return m;
}

/** Terminal wealth multiple from a return series. */
export const growthOf = (returns: number[]) => returns.reduce((g, r) => g * (1 + r), 1);

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const x = a.slice(-n), y = b.slice(-n);
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

export { mean, stdev };
