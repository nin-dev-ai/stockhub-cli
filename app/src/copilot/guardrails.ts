/**
 * Guardrails for the Copilot (AI-06, AI-08, AI-09). Detection runs on the user's message only;
 * screen context and strategy text are treated as data and never routed as instructions.
 */

const INJECTION = [
  /\b(ignore|disregard|forget|override)\b.{0,40}\b(instructions?|rules|guardrails?|prompt|previous|above|system)\b/i,
  /\bsystem prompt\b/i, /\byou are now\b/i, /\bdeveloper mode\b/i, /\bjailbreak\b/i, /\bact as\b.{0,30}\b(unrestricted|unfiltered|financial advisor)\b/i,
  /\bpretend\b.{0,40}\b(no|without)\b.{0,20}\b(rules|limits|restrictions)\b/i,
];

const CERTAINTY = [
  /\bguarantee[ds]?\b/i, /\bsure thing\b/i, /\bcan'?t lose\b/i, /\bcannot lose\b/i, /\brisk[- ]free (profit|return|money)\b/i,
  /\bwill (it|this|that|i|my|the (market|stock|portfolio|plan|strategy))\b.{0,30}\b(make|earn|go up|rise|double|triple|beat|outperform|be worth|crash|fall)\b/i,
  /\bhow much will (i|my|it|this)\b.{0,20}\b(make|earn|have|be worth|grow)\b/i,
  /\b(predict|forecast) (the|my|what|where|how)\b/i, /\bwhat will .{0,30} be worth\b/i, /\bnext (week|month|year)'?s? (price|return)\b/i,
];

const ADVICE = [
  /\bshould i (buy|sell|invest|put|hold|move)\b/i, /\bwhat should i (buy|invest|do with)\b/i,
  /\b(best|top) (stock|stocks|etf|etfs|investment|investments|strategy) (to buy|for me|right now)\b/i, /\bis (it|now) a good time to\b/i,
];

const ACTION = [
  /\b(place|submit|execute|send) (an? )?(order|trade)s?\b/i, /^\s*(buy|sell) \d/i, /\b(buy|sell) .{0,20} for me\b/i,
  /\b(rebalance|update|change|modify|edit|delete|set) (my|the) (portfolio|weights?|assumptions?|plan|inputs?|ledger|holdings)\b/i,
  /\b(publish|share) (my|the|this) strategy\b/i, /\b(save|add|record) .{0,20} (transaction|contribution|trade) for me\b/i,
];

export type GuardKind = "injection" | "certainty" | "advice" | "action";

export function classifyGuard(message: string): GuardKind | null {
  if (INJECTION.some((r) => r.test(message))) return "injection";
  if (ACTION.some((r) => r.test(message))) return "action";
  if (CERTAINTY.some((r) => r.test(message))) return "certainty";
  if (ADVICE.some((r) => r.test(message))) return "advice";
  return null;
}

/** Phrases an answer must never contain unless it is explaining why it refuses them. */
const UNSAFE_OUTPUT = [/\bguaranteed?\b/i, /\bwill definitely\b/i, /\bcertain to\b/i, /\brisk[- ]free (profit|return)\b/i, /\bcan'?t lose\b/i, /\byou should (buy|sell)\b/i];
export const hasUnsafeCertainty = (text: string) => UNSAFE_OUTPUT.some((r) => r.test(text));

// ---------------------------------------------------------------------------------------------
// Figure verification (AI-06)

/** Numeric tokens in text, normalized: "$1,234.50" -> "1234.50", "−3.2%" -> "3.2". */
export function extractNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.push(m[0].replace(/,/g, ""));
  return out;
}

export interface FigureCheck { ok: boolean; unverified: string[] }

/**
 * Every number in the answer must appear in the permitted sources: formatted engine facts,
 * generated rule text, vetted glossary text, or the user's own message. Anything else is
 * treated as an invented figure and the answer is withheld.
 */
export function verifyFigures(answer: string, permitted: string[]): FigureCheck {
  const allowed = new Set(permitted.flatMap(extractNumbers));
  const unverified = [...new Set(extractNumbers(answer).filter((n) => !allowed.has(n)))];
  return { ok: unverified.length === 0, unverified };
}
