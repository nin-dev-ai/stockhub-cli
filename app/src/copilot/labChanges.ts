import { INSTRUMENT_BY_TICKER } from "@/quant/instruments";
import { DEFAULT_LAB, validateLab, type LabInputs } from "@/quant/lab";
import { findTickers } from "./drafting";
import { MAX_SPREAD } from "@/quant/strategy";

/**
 * Lab inputs the Copilot may propose (permission level 1): the ETF (or several to spread across),
 * how many years of history to test, starting amount, monthly contribution and horizon. Each is undone by the Lab's Reset; nothing else in the plan
 * (costs, risk-free rate, weights) can be changed from the Copilot.
 */
export type LabChange = Partial<Pick<LabInputs, "etf" | "alsoEtfs" | "lookbackYears" | "initial" | "monthly" | "years">>;
export const LAB_CHANGE_FIELDS: Record<keyof LabChange, string> = {
  etf: "ETF", alsoEtfs: "Also run on", lookbackYears: "History to test (look back)", initial: "Starting amount", monthly: "Monthly contribution", years: "Horizon",
};

export interface LabChangeResult { change: LabChange; understood: string[]; errors: string[] }

const amount = (s: string) => {
  const m = /^\$?\s*([\d,]+(?:\.\d+)?)\s*(k|thousand|m|million)?$/i.exec(s.trim());
  if (!m) return null;
  const mult = /^(k|thousand)$/i.test(m[2] ?? "") ? 1e3 : /^(m|million)$/i.test(m[2] ?? "") ? 1e6 : 1;
  return Number(m[1].replace(/,/g, "")) * mult;
};
const AMT = String.raw`\$?\s*[\d,]+(?:\.\d+)?\s*(?:k|thousand|m|million)?`;

export function labChangeFromText(text: string): LabChangeResult {
  const change: LabChange = {};
  const understood: string[] = [];

  // ETF: an explicit ticker or a known alias ("the Nasdaq"), only when the message is about running on it;
  // several named ETFs spread the plan across them, a single one also clears an earlier spread
  if (/\b(on|to|with|using|into|switch|use|run|across|spread|split)\b/i.test(text)) {
    const etfs = findTickers(text).filter((t) => INSTRUMENT_BY_TICKER[t]).slice(0, MAX_SPREAD);
    if (etfs.length) { change.etf = etfs[0]; change.alsoEtfs = etfs.slice(1); }
  }
  const monthly = new RegExp(String.raw`(${AMT})\s*(?:a|per|each|every|\/)\s*month|monthly(?:\s+contributions?)?\s*(?:of|to|=|:|at)?\s*(${AMT})|contribut\w*\s*(?:of|to|=|:|at)?\s*(${AMT})`, "i").exec(text);
  if (monthly) { const v = amount(monthly[1] ?? monthly[2] ?? monthly[3]); if (v != null) change.monthly = v; }
  const initial = new RegExp(String.raw`(?:start(?:ing)?(?:\s+(?:amount|capital|balance))?(?:\s+with)?|initial(?:\s+(?:amount|capital|investment))?|lump[- ]sum|invest)\s*(?:of|to|=|:|at)?\s*(${AMT})(?![\d.,]|\s*(?:k|thousand|m|million)\b)(?!\s*(?:a|per|each|every|\/)\s*month)`, "i").exec(text);
  if (initial) { const v = amount(initial[1]); if (v != null) change.initial = v; }
  // "the last 10 years" is how much history to test; it must not be read as the projection horizon
  const back = /\b(?:last|past|previous|prior|trailing)\s+(\d{1,2})[- ]?(?:years?|yrs?)\b|\b(\d{1,2})[- ]?(?:years?|yrs?)\s+(?:of\s+)?(?:history|data|backtest|look[- ]?back)\b|\blook(?:ing)?[- ]?back\s+(?:of\s+)?(\d{1,2})[- ]?(?:years?|yrs?)\b/i.exec(text);
  if (back) change.lookbackYears = Number(back[1] ?? back[2] ?? back[3]);
  else if (/\b(all|full|entire|whole)\s+(?:available\s+)?(?:history|data)\b|\ball available\b/i.test(text)) change.lookbackYears = null;
  const rest = back ? text.replace(back[0], " ") : text;
  const years = /(\d{1,2})[- ]?(?:years?|yrs?)\b/i.exec(rest);
  if (years) change.years = Number(years[1]);

  if (change.etf && change.alsoEtfs?.length) {
    const all = [change.etf, ...change.alsoEtfs];
    understood.push(`ETFs → ${all.join(", ")}: basket strategies whose main ETF is SPY run separately on each, with the money split equally, and the results are added.`);
  } else if (change.etf) understood.push(`${LAB_CHANGE_FIELDS.etf} → ${change.etf} (${INSTRUMENT_BY_TICKER[change.etf].name}); it replaces SPY in basket strategies that trade it.`);
  if (change.initial != null) understood.push(`${LAB_CHANGE_FIELDS.initial} → $${change.initial.toLocaleString("en-US")}.`);
  if (change.monthly != null) understood.push(`${LAB_CHANGE_FIELDS.monthly} → $${change.monthly.toLocaleString("en-US")}.`);
  if (change.years != null) understood.push(`${LAB_CHANGE_FIELDS.years} → ${change.years} years.`);
  if ("lookbackYears" in change) understood.push(change.lookbackYears == null ? "History to test → everything available." : `History to test → the last ${change.lookbackYears} years (${LAB_CHANGE_FIELDS.years.toLowerCase()} is how far the projection runs).`);

  // validate the fields on their own, so an unrelated bad current input does not block the change
  const errors = Object.keys(change).length ? validateLab({ ...DEFAULT_LAB, ...change, initial: change.initial ?? 1 }) : [];
  return { change, understood, errors };
}
