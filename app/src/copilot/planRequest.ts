/**
 * "Build me a plan": reads how much of a fall the user will accept from the message ("a 25% fall
 * limit", "conservative", "aggressive"). The plan itself is proposed by the plan engine on a click,
 * because testing the catalog takes a moment; the Copilot only decides that this is what was asked.
 */
export interface PlanRequest { /** Fraction, 0.25 = 25%; null when the message names none. */ fallLimit: number | null; understood: string[] }

const RISK_WORDS: [RegExp, number, string][] = [
  [/\b(conservative|cautious|low[- ]risk|safe|careful|defensive)\b/i, 0.15, "conservative: a worst fall of about 15%"],
  [/\b(balanced|moderate|medium[- ]risk|middle)\b/i, 0.25, "balanced: a worst fall of about 25%"],
  [/\b(aggressive|growth|high[- ]risk|bold)\b/i, 0.4, "aggressive: a worst fall of about 40%"],
];

/** A request to propose a whole plan, not to change one input of the current plan. */
export function planRequestFromText(text: string): PlanRequest | null {
  const asks = /\b(build|make|create|suggest|propose|design|put together|recommend|set up|give)\b[^.?!]{0,40}\bplan\b/i.test(text)
    || /\bplan\b[^.?!]{0,20}\bfor me\b/i.test(text);
  if (!asks) return null;
  const understood: string[] = [];
  let fallLimit: number | null = null;
  const pct = /(\d{1,2})\s*%\s*(?:fall|drawdown|drop|loss|decline|dip)|(?:fall|drawdown|drop|loss|decline)[^0-9]{0,25}(\d{1,2})\s*%/i.exec(text);
  if (pct) {
    const v = Number(pct[1] ?? pct[2]);
    if (v >= 5 && v <= 90) { fallLimit = v / 100; understood.push(`A worst fall of no more than ${v}%.`); }
  }
  if (fallLimit == null) for (const [re, v, label] of RISK_WORDS) if (re.test(text)) { fallLimit = v; understood.push(`Read as ${label}.`); break; }
  return { fallLimit, understood };
}
