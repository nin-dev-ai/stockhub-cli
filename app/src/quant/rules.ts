import type { Allocation, StrategyDef } from "./strategy";

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function allocationRules(a: Allocation): string[] {
  switch (a.type) {
    case "static":
      return [`Target weights: ${Object.entries(a.weights).map(([t, w]) => `${t} ${pct(w)}`).join(", ")}.`];
    case "schedule":
      return [
        `Follows ${a.steps.length} dated changes of holdings from ${a.steps[0]?.date ?? "n/a"} to ${a.steps[a.steps.length - 1]?.date ?? "n/a"}; each set of weights holds until the next change.`,
        `Before the first change, and for any unallocated part, hold ${a.safe}.`,
      ];
    case "trend":
      return [
        `Compare ${a.risky}'s adjusted close with its ${a.smaDays}-day simple moving average at each close.`,
        `Hold 100% ${a.risky} when the close is above the average${a.bandPct > 0 ? ` by more than ${pct(a.bandPct, 1)}` : ""}; hold 100% ${a.safe} when it is below${a.bandPct > 0 ? ` by more than ${pct(a.bandPct, 1)}` : ""}.`,
        ...(a.bandPct > 0 ? ["Inside the band the previous position is kept, which reduces whipsaw trades."] : []),
      ];
    case "momentum":
      return [
        `Rank ${a.universe.join(", ")} by trailing ${a.lookbackDays}-day return.`,
        `Hold the top ${a.topN} in equal weight.`,
        a.absoluteFilter ? `Any selected asset with a negative trailing return is replaced by ${a.safe}.` : `Selected assets are held even if their return is negative.`,
      ];
    case "vol_target":
      return [
        `Measure ${a.risky}'s realized volatility over ${a.lookbackDays} days, annualized.`,
        `Risky weight = min(100%, ${pct(a.targetVol)} / realized volatility); the remainder is held in ${a.safe}.`,
        "Leverage is not used: the risky weight never exceeds 100%.",
      ];
    case "seasonal":
      return [
        `Hold ${a.risky} during ${a.riskyMonths.map((m) => MONTHS[m - 1]).join(", ")}; hold ${a.safe} in the other months.`,
        "The month of the current close decides the position that is filled at the next close.",
      ];
    case "tsmom":
      return [
        `If ${a.risky}'s trailing ${a.lookbackDays}-day return is positive, hold 100% ${a.risky}; otherwise hold 100% ${a.safe}.`,
      ];
    case "risk_parity":
      return [
        `Measure the annualized ${a.lookbackDays}-day volatility of ${a.assets.join(", ")}.`,
        "Weight each asset in proportion to 1 / its volatility, so calmer assets get more weight and each contributes a similar amount of volatility (correlations are ignored).",
        "Until volatility can be measured, hold equal weights.",
      ];
    case "multi_trend":
      return [
        `Give ${a.assets.join(", ")} an equal ${pct(1 / a.assets.length)} slot each.`,
        `Each asset keeps its slot while its close is above its ${a.smaDays}-day simple moving average; otherwise that slot is held in ${a.safe}.`,
      ];
    case "crossover":
      return [
        `Compare ${a.risky}'s ${a.fastDays}-day and ${a.slowDays}-day simple moving averages at each close.`,
        `Hold 100% ${a.risky} while the ${a.fastDays}-day average is above the ${a.slowDays}-day average; otherwise hold 100% ${a.safe}.`,
      ];
    case "mean_reversion":
      return [
        `Compute ${a.risky}'s ${a.rsiDays}-day RSI (Wilder) at each close.`,
        `Buy ${a.risky} when RSI falls below ${a.entryRsi}${a.trendDays > 0 ? ` and the close is above its ${a.trendDays}-day average` : ""}; sell back to ${a.safe} when RSI rises above ${a.exitRsi}.`,
        `Between signals the previous position is kept; out of the market the money sits in ${a.safe}.`,
      ];
  }
}

const SCHEDULE_TEXT: Record<string, string> = {
  daily: "at every close", weekly: "on the first trading day of each week", monthly: "on the first trading day of each month",
  quarterly: "on the first trading day of each quarter", annual: "on the first trading day of each year", none: "never",
};

export interface RuleParts { signal: string[]; schedule: string[]; execution: string }

export function describeRuleParts(d: StrategyDef): RuleParts {
  const signal = allocationRules(d.allocation);
  const schedule: string[] = [];
  const { schedule: sch, thresholdPct, minTradeWeight } = d.rebalance;
  if (thresholdPct !== undefined) schedule.push(`Rebalance when any holding drifts more than ${pct(thresholdPct)} from its target weight.`);
  else if (sch === "none") schedule.push("No rebalancing; holdings drift with the market. New cash is invested toward the targets.");
  else if (sch === "daily") schedule.push(`Re-evaluate ${SCHEDULE_TEXT.daily}; trade only when the target changes${minTradeWeight ? ` by more than ${pct(minTradeWeight)}` : ""}.`);
  else schedule.push(`Rebalance to the targets ${SCHEDULE_TEXT[sch]}.`);
  if (d.entry && d.entry.deployMonths > 0) schedule.push(`Initial capital is invested in ${d.entry.deployMonths} equal monthly tranches; the undeployed part stays in cash.`);
  if (d.spread) {
    const list = d.spread.targets.map((t) => `${t.ticker} (${pct(t.weight)})`).join(", ");
    signal.unshift(`Runs the rules below separately on ${list}, each in place of ${d.spread.from} and funded with its share of the starting amount and of every contribution; the results are added. The sleeves are not rebalanced against each other.`);
  }
  if (d.reserve) schedule.push(`${pct(d.reserve.fraction)} of each contribution is held in cash and invested in ${d.reserve.riskyTicker} when it is more than ${pct(-d.reserve.releaseDrawdown)} below its prior peak.`);
  return {
    signal, schedule,
    execution: "Decisions use data through the close; orders fill at the next trading day's close after slippage. Contributions are invested toward the targets without selling.",
  };
}

/** Plain-English rules generated from the machine-readable definition so the two cannot drift apart. */
export function describeRules(d: StrategyDef): string[] {
  const p = describeRuleParts(d);
  return [...p.signal, ...p.schedule, p.execution];
}
