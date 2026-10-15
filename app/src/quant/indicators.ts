/**
 * Indicators return arrays aligned to the input. Entry i uses data up to and including i only,
 * so a decision at index i never sees the future. NaN marks the warm-up period.
 */
export function sma(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i];
    if (i >= n) sum -= x[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** Trailing total return over n observations: x[i]/x[i-n] - 1. */
export function trailingReturn(x: number[], n: number): number[] {
  return x.map((v, i) => (i >= n && x[i - n] > 0 ? v / x[i - n] - 1 : NaN));
}

/** Running peak-to-current drawdown, <= 0. */
export function drawdownSeries(x: number[]): number[] {
  let peak = -Infinity;
  return x.map((v) => { peak = Math.max(peak, v); return peak > 0 ? v / peak - 1 : 0; });
}

/** Annualized stdev of simple returns over a trailing window of n returns. */
export function rollingVol(prices: number[], n: number, periods = 252): number[] {
  const r = prices.map((p, i) => (i > 0 ? p / prices[i - 1] - 1 : NaN));
  const out = new Array<number>(prices.length).fill(NaN);
  for (let i = n; i < prices.length; i++) {
    const w = r.slice(i - n + 1, i + 1);
    const m = w.reduce((a, b) => a + b, 0) / n;
    const v = w.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1);
    out[i] = Math.sqrt(v) * Math.sqrt(periods);
  }
  return out;
}

export function pctReturns(prices: number[]): number[] {
  return prices.slice(1).map((p, i) => p / prices[i] - 1);
}

/** Wilder's relative strength index (0-100) over n periods; NaN until n changes are available. */
export function rsi(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  let gain = 0, loss = 0;
  for (let i = 1; i < x.length; i++) {
    const ch = x[i] - x[i - 1];
    const g = Math.max(0, ch), l = Math.max(0, -ch);
    if (i <= n) { gain += g / n; loss += l / n; }
    else { gain = (gain * (n - 1) + g) / n; loss = (loss * (n - 1) + l) / n; }
    if (i >= n) out[i] = loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
  }
  return out;
}
