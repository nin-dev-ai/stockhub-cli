import { CATALOG } from "@/quant/catalog";
import { INSTRUMENT_BY_TICKER, INSTRUMENTS } from "@/quant/instruments";
import { describeRules } from "@/quant/rules";
import { allocationTickers, requiredTickers, retarget, validateStrategy, type Allocation, type Schedule, type StrategyDef } from "@/quant/strategy";

/**
 * Rule-based translation of a plain-English idea into the versioned strategy DSL (AI-04).
 * It only proposes; nothing is saved or run until the user confirms in the UI.
 */

export interface DraftResult {
  def: StrategyDef | null;
  /** What was read from the text, one line per decision. */
  understood: string[];
  /** Defaults the drafter filled in because the text did not say. */
  assumptions: string[];
  /** Parts of the request that cannot be expressed or are not supported. */
  unsupported: string[];
  errors: string[];
  /** The curated or context strategy the draft is compared with. */
  base: StrategyDef | null;
}

const ALIASES: [RegExp, string][] = [
  [/\bs ?& ?p ?500\b|\bs&p\b|\bsp ?500\b|\blarge[- ]cap(s)?\b|\bus (stocks|equities)\b/i, "SPY"],
  [/\bnasdaq(-100)?\b|\btech(nology)? stocks\b/i, "QQQ"],
  [/\brussell( 2000)?\b|\bsmall[- ]caps?\b/i, "IWM"],
  [/\binternational (stocks|equities)\b|\bdeveloped markets?\b|\beafe\b/i, "EFA"],
  [/\bemerging markets?\b/i, "EEM"],
  [/\b(aggregate )?bonds?\b|\bbond (etf|fund)\b/i, "AGG"],
  [/\blong[- ](term )?treasur(y|ies)\b/i, "TLT"],
  [/\b(intermediate|mid)[- ](term )?treasur(y|ies)\b/i, "IEF"],
  [/\bgold\b/i, "GLD"],
  [/\breal estate\b|\breits?\b/i, "VNQ"],
  [/\bcash\b|\bshort[- ](term )?treasur(y|ies)\b|\bt-?bills?\b|\bmoney market\b/i, "SHY"],
];
const UNSUPPORTED: [RegExp, string][] = [
  [/\bnifty\b|\bsensex\b/i, "Indian-listed instruments such as the Nifty 50 are not supported: only US-listed ETFs in USD (INDA tracks MSCI India)."],
  [/\bbitcoin\b|\bcrypto\b|\bethereum\b/i, "Crypto assets are not in the strategy universe."],
  [/\bleverage[d]?\b|\bmargin\b|\b[23]x\b/i, "Leverage is not allowed; strategies are long-only and fully invested."],
  [/\bshort(ing| sell| the)\b|\bshort [A-Z]{2,5}\b/, "Short selling is not supported."],
  [/\b(call|put) options?\b|\boptions? (contracts?|chain|strateg(y|ies))\b|\bfutures\b/i, "Options and futures are not supported."],
  [/\bstop[- ]loss\b|\btake[- ]profit\b|\bintraday\b/i, "Intraday orders such as stop-losses are not supported; decisions use daily closes."],
  [/\b(earnings|p\/?e|valuation|macd)\b/i, "Only price-based rules on ETFs are supported; valuation and MACD signals are not in the DSL."],
  [/\brsi\b/i, "Drafting RSI rules from text is not supported; fork the \"RSI(2) pullback in an uptrend\" strategy and edit its parameters instead."],
];

const EQUITY = INSTRUMENTS.filter((i) => i.type === "equity_etf").map((i) => i.ticker);
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WORDNUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, twelve: 12 };

/** Tickers in order of first mention, from symbols or plain names. */
export function findTickers(text: string): string[] {
  const hits: { t: string; at: number }[] = [];
  for (const m of text.matchAll(/\b[A-Z]{3,4}\b/g)) if (INSTRUMENT_BY_TICKER[m[0]]) hits.push({ t: m[0], at: m.index! });
  for (const [re, t] of ALIASES) { const m = re.exec(text); if (m) hits.push({ t, at: m.index }); }
  // plain "stocks" means the S&P 500 only when no specific equity market was named
  const generic = /\b(stocks|equities|equity)\b/i.exec(text);
  if (generic && !hits.some((h) => EQUITY.includes(h.t))) hits.push({ t: "SPY", at: generic.index });
  hits.sort((a, b) => a.at - b.at);
  return [...new Set(hits.map((h) => h.t))];
}

const num = (s: string) => Number(s.replace(/,/g, ""));

function schedule(text: string): Schedule | null {
  if (/\bdaily\b|\bevery day\b/i.test(text)) return "daily";
  if (/\bweekly\b|\bevery week\b/i.test(text)) return "weekly";
  if (/\bmonthly\b|\bevery month\b|\beach month\b/i.test(text)) return "monthly";
  if (/\bquarterly\b|\bevery quarter\b|\beach quarter\b/i.test(text)) return "quarterly";
  if (/\bannual(ly)?\b|\byearly\b|\bevery year\b|\bonce a year\b/i.test(text)) return "annual";
  return null;
}

function lookbackDays(text: string): number | null {
  const m = /(\d+)[- ]?(months?|mos?)\b/i.exec(text);
  if (m) return Math.round(num(m[1]) * 21);
  const d = /(\d+)[- ]?(trading[- ])?days?\b/i.exec(text);
  return d ? num(d[1]) : null;
}

function monthsFrom(text: string): number[] | null {
  const lower = text.toLowerCase();
  const range = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b\s*(?:to|through|until|-|–)\s*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/.exec(lower);
  if (range) {
    const a = MONTHS.indexOf(range[1]), b = MONTHS.indexOf(range[2]);
    const out: number[] = [];
    for (let i = a; ; i = (i + 1) % 12) { out.push(i + 1); if (i === b) break; }
    return out;
  }
  if (/sell in may/.test(lower)) return [11, 12, 1, 2, 3, 4];
  // a list needs two or more month names, so a stray "may" is not read as a month
  const list = [...lower.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/g)].map((m) => MONTHS.indexOf(m[1]) + 1);
  const uniq = [...new Set(list)].sort((x, y) => x - y);
  return uniq.length >= 2 ? uniq : null;
}

/** Explicit percentages next to tickers, e.g. "60% SPY 40% AGG" or "60/40 stocks and bonds". */
function staticWeights(text: string, tickers: string[]): Record<string, number> | null {
  const slash = /(\d{1,3})\s*\/\s*(\d{1,3})(?:\s*\/\s*(\d{1,3}))?(?:\s*\/\s*(\d{1,3}))?/.exec(text);
  if (slash) {
    const parts = slash.slice(1).filter(Boolean).map(num);
    if (parts.length === tickers.length || (parts.length < tickers.length && parts.length >= 2)) {
      return Object.fromEntries(tickers.slice(0, parts.length).map((t, i) => [t, parts[i] / 100]));
    }
  }
  const pairs: Record<string, number> = {};
  for (const t of tickers) {
    const names = [t, ...ALIASES.filter(([, x]) => x === t).map(([re]) => re.source)];
    for (const n of names) {
      const re = new RegExp(`(\\d{1,3}(?:\\.\\d+)?)\\s*%\\s*(?:in(?:to)?\\s+|of\\s+)?(?:${n})|(?:${n})\\s*(?:at\\s+)?(\\d{1,3}(?:\\.\\d+)?)\\s*%`, "i");
      const m = re.exec(text);
      if (m) { pairs[t] = num(m[1] ?? m[2]) / 100; break; }
    }
  }
  return Object.keys(pairs).length ? pairs : null;
}

const pctIn = (text: string, re: RegExp) => { const m = re.exec(text); const g = m?.slice(1).find((x) => x != null); return g != null ? num(g) / 100 : null; };

let counter = 0;
const draftId = (type: string, taken: Set<string>) => {
  let id = "";
  do { counter++; id = `ai_${type}_${counter}`; } while (taken.has(id));
  return id;
};

export function draftFromText(text: string, opts: { takenIds?: string[]; base?: StrategyDef | null } = {}): DraftResult {
  const understood: string[] = [], assumptions: string[] = [], unsupported: string[] = [];
  for (const [re, msg] of UNSUPPORTED) if (re.test(text)) unsupported.push(msg);

  const modifying = opts.base ?? null;
  const tickers = findTickers(text);
  const safeNamed = tickers.find((t) => ["SHY", "AGG", "IEF", "TLT"].includes(t) && /\b(else|otherwise|safe|instead|move to|switch to|fallback|go to|into)\b/i.test(text));
  const risky = tickers.find((t) => t !== safeNamed) ?? null;
  const days = lookbackDays(text);
  const sched = schedule(text);

  let allocation: Allocation | null = null;
  let type = "";
  const tellSafe = (fallback: string) => {
    if (safeNamed) return safeNamed;
    assumptions.push(`No safe asset was named; using ${fallback} (${INSTRUMENT_BY_TICKER[fallback].name}).`);
    return fallback;
  };

  if (/\bmoving[- ]average\b|\bsma\b|\b\d+[- ]?day (ma|average)\b/i.test(text)) {
    type = "trend";
    const sma = /(\d+)[- ]?(?:day|d)\b/i.exec(text);
    const band = pctIn(text, /band of (\d+(?:\.\d+)?)\s*%|(\d+(?:\.\d+)?)\s*% band/i) ?? null;
    const r = risky ?? "SPY";
    if (!risky) assumptions.push("No asset was named; using SPY (S&P 500 ETF).");
    const smaDays = sma ? num(sma[1]) : 200;
    if (!sma) assumptions.push("No average length was given; using 200 days.");
    allocation = { type: "trend", risky: r, safe: tellSafe("SHY"), smaDays, bandPct: band ?? 0 };
    understood.push(`Trend rule: hold ${r} above its ${smaDays}-day moving average, otherwise ${allocation.safe}.`);
  } else if (/\bmomentum\b|\bstrongest\b|\bbest[- ]performing\b|\btop (\d+|one|two|three)\b|\brotat(e|ion)\b/i.test(text)) {
    type = "momentum";
    const top = /\btop (\d+|one|two|three)\b/i.exec(text);
    const universe = tickers.filter((t) => t !== safeNamed);
    const u = universe.length >= 2 ? universe : ["SPY", "QQQ", "IWM", "EFA", "EEM"];
    if (universe.length < 2) assumptions.push("Fewer than two assets were named; using the curated equity set SPY, QQQ, IWM, EFA and EEM.");
    const topN = top ? (WORDNUM[top[1].toLowerCase()] ?? num(top[1])) : 1;
    if (!top) assumptions.push("The number of holdings was not given; holding the single strongest asset.");
    const lb = days ?? 126;
    if (!days) assumptions.push("No lookback was given; using 126 trading days (about 6 months).");
    const absolute = !/\beven if negative\b|\bno (absolute|cash) filter\b/i.test(text);
    allocation = { type: "momentum", universe: u, lookbackDays: lb, topN: Math.min(topN, u.length), safe: tellSafe("SHY"), absoluteFilter: absolute };
    understood.push(`Momentum rotation: rank ${u.join(", ")} by ${lb}-day return and hold the top ${allocation.topN}${absolute ? `, replacing any with a negative return by ${allocation.safe}` : ""}.`);
  } else if (/\bvolatility\b|\bvol[- ]target/i.test(text)) {
    type = "vol_target";
    const tv = pctIn(text, /(\d+(?:\.\d+)?)\s*%\s*(?:annual(?:ized)?\s*)?(?:volatility|vol)\b|target(?:ing)?\s*(?:volatility|vol)?\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*%/i);
    const r = risky ?? "SPY";
    if (!risky) assumptions.push("No asset was named; using SPY.");
    const targetVol = tv ?? 0.1;
    if (tv == null) assumptions.push("No target was given; using 10% annualized volatility.");
    const lb = days ?? 63;
    if (!days) assumptions.push("No lookback was given; using 63 trading days.");
    allocation = { type: "vol_target", risky: r, safe: tellSafe("SHY"), targetVol, lookbackDays: lb };
    understood.push(`Volatility target: scale ${r} to ${(targetVol * 100).toFixed(0)}% volatility over ${lb} days, capped at 100%, rest in ${allocation.safe}.`);
  } else if (monthsFrom(text) && /\b(season|seasonal|month|months|halloween|sell in may|winter|summer)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (to|through|until)\b/i.test(text)) {
    type = "seasonal";
    const months = monthsFrom(text)!;
    const r = risky ?? "SPY";
    if (!risky) assumptions.push("No asset was named; using SPY.");
    allocation = { type: "seasonal", risky: r, safe: tellSafe("SHY"), riskyMonths: months };
    understood.push(`Seasonal rule: hold ${r} in months ${months.join(", ")}, otherwise ${allocation.safe}.`);
  } else if (/\b(trailing|past|last) .{0,20}\breturn\b.{0,30}\b(positive|negative|above zero|up)\b|\babsolute momentum\b|\btime[- ]series momentum\b/i.test(text)) {
    type = "tsmom";
    const r = risky ?? "SPY";
    const lb = days ?? 252;
    if (!days) assumptions.push("No lookback was given; using 252 trading days (about 12 months).");
    allocation = { type: "tsmom", risky: r, safe: tellSafe("AGG"), lookbackDays: lb };
    understood.push(`Trend regime: hold ${r} when its ${lb}-day return is positive, otherwise ${allocation.safe}.`);
  } else if (tickers.length > 0) {
    type = "static";
    let w = staticWeights(text, tickers);
    if (!w) {
      w = Object.fromEntries(tickers.map((t) => [t, 1 / tickers.length]));
      if (tickers.length > 1) assumptions.push("No weights were given; splitting equally.");
    }
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 1e-6) {
      const missing = tickers.filter((t) => w![t] == null);
      if (missing.length === 1 && sum < 1) { w[missing[0]] = +(1 - sum).toFixed(6); assumptions.push(`${missing[0]} takes the remaining ${((1 - sum) * 100).toFixed(0)}%.`); }
    }
    allocation = { type: "static", weights: w };
    understood.push(`Fixed weights: ${Object.entries(w).map(([t, x]) => `${t} ${(x * 100).toFixed(0)}%`).join(", ")}.`);
  }

  // Changes to a strategy in context: apply numbers the text mentions to a copy of it.
  if (!allocation && modifying) return modify(text, modifying, { understood, assumptions, unsupported, takenIds: opts.takenIds ?? [] });

  if (!allocation) {
    return { def: null, understood, assumptions, unsupported, base: null,
      errors: ["I could not find a supported rule or ETF in that description. Name at least one US-listed ETF or asset class (for example S&P 500, bonds, gold) and a rule such as fixed weights, a moving average, momentum, a volatility target, a calendar season or a trailing-return filter."] };
  }

  const isStatic = allocation.type === "static";
  const multi = allocation.type === "static" && Object.keys(allocation.weights).length > 1;
  const drift = pctIn(text, /(\d+(?:\.\d+)?)\s*(?:%|percent|points?|pts)\s*(?:drift|threshold|band)|(?:drift|threshold)\D{0,25}?(\d+(?:\.\d+)?)\s*(?:%|percent|points?)/i);
  const defaultSched: Schedule = type === "momentum" || type === "tsmom" ? "monthly" : type === "vol_target" ? "weekly" : type === "trend" || type === "seasonal" ? "daily" : multi ? "quarterly" : "none";
  const rebalance: StrategyDef["rebalance"] = drift != null && isStatic
    ? { schedule: "none", thresholdPct: drift }
    : { schedule: sched ?? defaultSched, ...(type === "vol_target" ? { minTradeWeight: 0.05 } : {}) };
  if (drift != null && isStatic) understood.push(`Rebalance when a weight drifts more than ${(drift * 100).toFixed(0)} points.`);
  else if (sched) understood.push(`Schedule: ${sched}.`);
  else assumptions.push(`No schedule was given; using ${defaultSched === "none" ? "no rebalancing" : defaultSched} for this rule type.`);

  const dca = /\bdollar[- ]cost|\bdca\b|\bin (\d+) (equal )?(monthly )?(steps|tranches|instal?lments|parts)\b|\bspread\b.{0,40}\bover (\d+) months\b/i.exec(text);
  let entry: StrategyDef["entry"];
  if (dca) {
    const m = /(\d+) (equal )?(monthly )?(steps|tranches|instal?lments|parts|months)/i.exec(text);
    entry = { deployMonths: m ? num(m[1]) : 12 };
    if (!m) assumptions.push("Dollar-cost averaging without a length; spreading the starting amount over 12 months.");
    understood.push(`Invest the starting amount over ${entry.deployMonths} monthly steps.`);
  }
  let reserve: StrategyDef["reserve"];
  const res = /(?:keep|hold|save|reserve)\s*(\d+)\s*%.{0,40}\bcash\b.{0,80}?(\d+)\s*%/i.exec(text);
  if (res && /\b(drawdown|dip|drops?|falls?|below (its )?(peak|high))\b/i.test(text)) {
    const r = risky ?? "SPY";
    reserve = { fraction: num(res[1]) / 100, riskyTicker: r, releaseDrawdown: -num(res[2]) / 100 };
    understood.push(`Hold ${res[1]}% of each contribution in cash and invest it when ${r} is ${res[2]}% below its peak.`);
  }

  const universe = [...new Set([...(allocation.type === "static" ? Object.keys(allocation.weights) : []), ...("risky" in allocation ? [allocation.risky, allocation.safe] : []), ...(allocation.type === "momentum" ? [...allocation.universe, allocation.safe] : [])])];
  const taken = new Set([...(opts.takenIds ?? []), ...CATALOG.map((c) => c.id)]);
  const def: StrategyDef = {
    schema: 1, id: draftId(type, taken), version: 1, region: "US", evidence: "Backtested",
    name: `Copilot draft: ${understood[0]?.split(":")[0] ?? "strategy"} (${universe.slice(0, 3).join("/")})`,
    summary: understood[0] ?? "",
    intendedUse: "A user idea drafted by the Copilot. Review every parameter before running it.",
    tags: ["ETF", "draft", "copilot"], holdingPeriod: "Not specified", riskLevel: undefined,
    universe, benchmark: "SPY", allocation, rebalance,
    ...(entry ? { entry } : {}), ...(reserve ? { reserve } : {}),
    methodology: "Drafted from a natural-language description by rule-based parsing. The plain-English rules are generated from this definition.",
    caveats: ["Parameters are the Copilot's reading of your description; check them.", "Not backtested until you run it on the Strategies screen."],
    experimental: true,
  };
  const v = validateStrategy(def);
  const base = closestCurated(def);
  return { def, understood, assumptions, unsupported, errors: v.errors, base };
}

/** Applies parameters named in the text to a copy of an existing strategy; the original is untouched. */
export function modifyFromText(text: string, base: StrategyDef, takenIds: string[] = []): DraftResult {
  const unsupported = UNSUPPORTED.filter(([re]) => re.test(text)).map(([, msg]) => msg);
  return modify(text, base, { understood: [], assumptions: [], unsupported, takenIds });
}

function modify(text: string, base: StrategyDef, a: { understood: string[]; assumptions: string[]; unsupported: string[]; takenIds: string[] }): DraftResult {
  const next = structuredClone(base) as StrategyDef;
  const al = next.allocation;
  const days = lookbackDays(text);
  const sched = schedule(text);
  let changed = false;
  if (al.type === "trend") {
    const m = /(\d+)[- ]?(?:day|d)\b/i.exec(text);
    if (m) { al.smaDays = num(m[1]); a.understood.push(`Moving average length → ${al.smaDays} days.`); changed = true; }
    const band = pctIn(text, /band (?:of |to )?(\d+(?:\.\d+)?)\s*%/i);
    if (band != null) { al.bandPct = band; a.understood.push(`Band → ${(band * 100).toFixed(1)}%.`); changed = true; }
  }
  if ((al.type === "momentum" || al.type === "tsmom" || al.type === "vol_target") && days) { al.lookbackDays = days; a.understood.push(`Lookback → ${days} trading days.`); changed = true; }
  if (al.type === "momentum") {
    const top = /\btop (\d+|one|two|three)\b/i.exec(text);
    if (top) { al.topN = WORDNUM[top[1].toLowerCase()] ?? num(top[1]); a.understood.push(`Hold the top ${al.topN}.`); changed = true; }
  }
  if (al.type === "vol_target") {
    const tv = pctIn(text, /(\d+(?:\.\d+)?)\s*%\s*(?:volatility|vol)|target (?:of |to )?(\d+(?:\.\d+)?)\s*%/i);
    if (tv != null) { al.targetVol = tv; a.understood.push(`Target volatility → ${(tv * 100).toFixed(0)}%.`); changed = true; }
  }
  if (al.type === "static") {
    const w = staticWeights(text, Object.keys(al.weights));
    if (w && Object.keys(w).length === Object.keys(al.weights).length) { al.weights = w; a.understood.push(`Weights → ${Object.entries(w).map(([t, x]) => `${t} ${(x * 100).toFixed(0)}%`).join(", ")}.`); changed = true; }
  }
  if (al.type === "seasonal") { const m = monthsFrom(text); if (m) { al.riskyMonths = m; a.understood.push(`Risky months → ${m.join(", ")}.`); changed = true; } }
  if (sched) { next.rebalance = { ...next.rebalance, schedule: sched }; delete next.rebalance.thresholdPct; a.understood.push(`Schedule → ${sched}.`); changed = true; }
  if (!changed) {
    return { def: null, ...a, base, errors: [`I could not find a parameter to change for ${base.name}. Try for example "use a 150-day average", "top 3", "rebalance annually" or "70/30".`] };
  }
  const taken = new Set([...a.takenIds, ...CATALOG.map((c) => c.id)]);
  const root = base.id.replace(/_d\d+$|_c\d+$/, "").slice(0, 48);
  let n = 1;
  while (taken.has(`${root}_c${n}`)) n++;
  Object.assign(next, { id: `${root}_c${n}`, version: 1, name: `${base.name} (Copilot edit)`, forkOf: `${base.id}@${base.version}`, evidence: "Backtested", tags: [...new Set([...base.tags, "draft", "copilot"])] });
  if (next.sensitivity) delete next.sensitivity;
  return { def: next, ...a, base, errors: validateStrategy(next).errors };
}

/** The curated strategy with the same rule type and most shared tickers, used as a reference for the diff. */
const DEFENSIVE = new Set(["bond_etf", "cash_etf"]);
const isDefensive = (t: string) => DEFENSIVE.has(INSTRUMENT_BY_TICKER[t]?.type ?? "");

/**
 * "Run the golden cross on QQQ", "use BIL instead of SHY": the same rules on other ETFs.
 * An explicit "X instead of Y" / "replace Y with X" maps Y to X. Otherwise each newly named ETF
 * replaces the strategy's main ETF of the same kind: an equity, gold or property ETF replaces its
 * main risky holding (SPY when it trades SPY), a bond or cash ETF replaces its defensive holding.
 */
export function variantFromText(text: string, base: StrategyDef): DraftResult {
  const name = CATALOG.some((s) => s.id === base.id && s.name === base.name) ? base.name : "this draft";
  const res: DraftResult = { def: null, understood: [], assumptions: [], unsupported: [], errors: [], base };
  const used = requiredTickers(base);
  const traded = allocationTickers(base.allocation);
  const map: Record<string, string> = {};
  const tick = (s: string) => findTickers(s)[0];
  for (const m of text.matchAll(/([\w&$ -]{2,40}?)\s+instead of\s+([\w&$ -]{2,40})/gi)) {
    const to = tick(m[1].split(/\b(use|with|run|try|put)\b/i).pop() ?? m[1]), from = tick(m[2]);
    if (to && from) map[from] = to;
  }
  for (const m of text.matchAll(/\b(?:replace|swap)\s+([\w&$ -]{2,40}?)\s+(?:with|for|by)\s+([\w&$ -]{2,40})/gi)) {
    const from = tick(m[1]), to = tick(m[2]);
    if (to && from) map[from] = to;
  }
  if (Object.keys(map).length === 0) {
    for (const t of findTickers(text).filter((x) => !used.includes(x))) {
      const pool = traded.filter((x) => isDefensive(x) === isDefensive(t));
      const from = isDefensive(t) ? (pool.includes("SHY") ? "SHY" : pool[pool.length - 1]) : (pool.includes("SPY") ? "SPY" : pool[0]);
      if (from && !map[from]) map[from] = t;
      else if (!from) res.unsupported.push(`${name} holds no ${isDefensive(t) ? "bond or cash" : "risky"} ETF for ${t} to replace.`);
    }
  }
  for (const from of Object.keys(map)) if (!used.includes(from)) { res.unsupported.push(`${name} does not use ${from}, so there is nothing to replace.`); delete map[from]; }
  if (Object.keys(map).length === 0) {
    res.errors.push(`Name the ETF to run ${name} on, for example "on QQQ" or "use BIL instead of SHY".`);
    return res;
  }
  const def = retarget(base, map);
  for (const [from, to] of Object.entries(map)) res.understood.push(`${from} → ${to} (${INSTRUMENT_BY_TICKER[to].name}).`);
  if (def.benchmark !== base.benchmark) res.understood.push(`Benchmark → ${def.benchmark} buy and hold, so the comparison is against simply owning it.`);
  res.assumptions.push(`All rules and parameters are kept from ${name}; they were tuned on ${Object.keys(map).join(", ")}.`);
  const late = Object.values(map).filter((t) => INSTRUMENT_BY_TICKER[t].inception >= "2005");
  if (late.length) res.assumptions.push(`${late.join(", ")} started trading in ${late.map((t) => INSTRUMENT_BY_TICKER[t].inception.slice(0, 4)).join(", ")}, so the backtest window will be shorter.`);
  res.def = def;
  res.errors = validateStrategy(def).errors;
  return res;
}

export function closestCurated(d: StrategyDef): StrategyDef | null {
  const same = CATALOG.filter((c) => c.allocation.type === d.allocation.type);
  if (same.length === 0) return null;
  const overlap = (c: StrategyDef) => c.universe.filter((t) => d.universe.includes(t)).length;
  return [...same].sort((a, b) => overlap(b) - overlap(a))[0];
}

export interface DiffRow { path: string; before: string; after: string }

function flatten(o: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (o !== undefined) out[prefix] = JSON.stringify(o);
  return out;
}

const RULE_KEYS = /^(allocation|rebalance|entry|reserve|universe|benchmark)/;

/** Differences in the fields that change behaviour (allocation, schedule, entry, reserve, universe). */
export function diffStrategy(before: StrategyDef | null, after: StrategyDef): DiffRow[] {
  const a = before ? flatten(before) : {}, b = flatten(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => RULE_KEYS.test(k)).sort();
  return keys.filter((k) => a[k] !== b[k]).map((k) => ({ path: k, before: a[k] ?? "—", after: b[k] ?? "—" }));
}

export const previewRules = (d: StrategyDef) => describeRules(d);
