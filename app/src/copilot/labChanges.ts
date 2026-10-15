import { INSTRUMENT_BY_TICKER } from "@/quant/instruments";
import { DEFAULT_LAB, validateLab, type LabInputs } from "@/quant/lab";
import { findTickers } from "./drafting";

/**
 * Lab inputs the Copilot may propose (permission level 1): the ETF, starting amount, monthly
 * contribution and horizon. Each is undone by the Lab's Reset; nothing else in the plan
 * (costs, risk-free rate, weights) can be changed from the Copilot.
 */
export type LabChange = Partial<Pick<LabInputs, "etf" | "initial" | "monthly" | "years">>;
export const LAB_CHANGE_FIELDS: Record<keyof LabChange, string> = {
  etf: "ETF", initial: "Starting amount", monthly: "Monthly contribution", years: "Horizon",
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

  // ETF: an explicit ticker or a known alias ("the Nasdaq"), only when the message is about running on it
  if (/\b(on|to|with|using|into|switch|use|run)\b/i.test(text)) {
    const etf = findTickers(text).find((t) => INSTRUMENT_BY_TICKER[t]);
    if (etf) change.etf = etf;
  }
  const monthly = new RegExp(String.raw`(${AMT})\s*(?:a|per|each|every|\/)\s*month|monthly(?:\s+contributions?)?\s*(?:of|to|=|:|at)?\s*(${AMT})|contribut\w*\s*(?:of|to|=|:|at)?\s*(${AMT})`, "i").exec(text);
  if (monthly) { const v = amount(monthly[1] ?? monthly[2] ?? monthly[3]); if (v != null) change.monthly = v; }
  const initial = new RegExp(String.raw`(?:start(?:ing)?(?:\s+(?:amount|capital|balance))?(?:\s+with)?|initial(?:\s+(?:amount|capital|investment))?|lump[- ]sum|invest)\s*(?:of|to|=|:|at)?\s*(${AMT})(?![\d.,]|\s*(?:k|thousand|m|million)\b)(?!\s*(?:a|per|each|every|\/)\s*month)`, "i").exec(text);
  if (initial) { const v = amount(initial[1]); if (v != null) change.initial = v; }
  const years = /(\d{1,2})[- ]?(?:years?|yrs?)\b/i.exec(text);
  if (years) change.years = Number(years[1]);

  if (change.etf) understood.push(`${LAB_CHANGE_FIELDS.etf} → ${change.etf} (${INSTRUMENT_BY_TICKER[change.etf].name}); it replaces SPY in basket strategies that trade it.`);
  if (change.initial != null) understood.push(`${LAB_CHANGE_FIELDS.initial} → $${change.initial.toLocaleString("en-US")}.`);
  if (change.monthly != null) understood.push(`${LAB_CHANGE_FIELDS.monthly} → $${change.monthly.toLocaleString("en-US")}.`);
  if (change.years != null) understood.push(`${LAB_CHANGE_FIELDS.years} → ${change.years} years.`);

  // validate the fields on their own, so an unrelated bad current input does not block the change
  const errors = Object.keys(change).length ? validateLab({ ...DEFAULT_LAB, ...change, initial: change.initial ?? 1 }) : [];
  return { change, understood, errors };
}
