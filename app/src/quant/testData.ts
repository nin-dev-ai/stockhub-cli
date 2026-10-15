import { buildDataset, type Dataset, type RawBar } from "./data";
import { makeRng } from "./rng";

export function bdays(start: string, n: number): string[] {
  const out: string[] = []; let t = Date.parse(start);
  while (out.length < n) { const d = new Date(t); t += 864e5; if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10)); }
  return out;
}

const PARAMS: Record<string, [number, number]> = {
  SPY: [0.09, 0.16], QQQ: [0.11, 0.22], IWM: [0.08, 0.2], EFA: [0.06, 0.17], EEM: [0.07, 0.22],
  AGG: [0.035, 0.04], TLT: [0.04, 0.14], IEF: [0.035, 0.07], GLD: [0.07, 0.16], VNQ: [0.08, 0.22], SHY: [0.02, 0.005],
};

/** Seeded synthetic ETF prices with a shared market factor, for offline tests. */
export function syntheticDataset(years: number, seed = 1, tickers = Object.keys(PARAMS)): Dataset {
  const n = Math.round(years * 252);
  const dates = bdays("2004-01-02", n);
  const rng = makeRng(seed);
  const market = Array.from({ length: n }, () => rng.normal());
  const raw: Record<string, RawBar[]> = {};
  for (const t of tickers) {
    const [mu, sigma] = PARAMS[t];
    const own = makeRng(seed * 1000 + t.charCodeAt(0) * 31 + t.charCodeAt(1));
    let p = 100;
    raw[t] = dates.map((date, i) => {
      const beta = t === "AGG" || t === "SHY" || t === "IEF" ? 0.05 : t === "TLT" ? -0.1 : 0.7;
      const z = beta * market[i] + Math.sqrt(1 - beta * beta) * own.normal();
      p *= 1 + mu / 252 + (sigma / Math.sqrt(252)) * z;
      return { date, close: p };
    });
  }
  return buildDataset(raw, { provider: "synthetic", fetchedAt: `${dates[n - 1]}T00:00:00Z` });
}
