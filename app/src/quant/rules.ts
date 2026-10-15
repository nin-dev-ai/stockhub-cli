import type { Allocation, StrategyDef } from "./strategy";

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function allocationRules(a: Allocation): string[] {
  switch (a.type) {
    case "static":
      return [`Target weights: ${Object.entries(a.weights).map(([t, w]) => `${t} ${pct(w)}`).join(", ")}.`];
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
  }
}

const SCHEDULE_TEXT: Record<string, string> = {
  daily: "at every close", weekly: "on the first trading day of each week", monthly: "on the first trading day of each month",
  quarterly: "on the first trading day of each quarter", annual: "on the first trading day of each year", none: "never",
};

/** Plain-English rules generated from the machine-readable definition so the two cannot drift apart. */
export function describeRules(d: StrategyDef): string[] {
  const out = [...allocationRules(d.allocation)];
  const { schedule, thresholdPct, minTradeWeight } = d.rebalance;
  if (thresholdPct !== undefined) out.push(`Rebalance when any holding drifts more than ${pct(thresholdPct)} from its target weight.`);
  else if (schedule === "none") out.push("No rebalancing; holdings drift with the market. New cash is invested toward the targets.");
  else if (schedule === "daily") out.push(`Re-evaluate ${SCHEDULE_TEXT.daily}; trade only when the target changes${minTradeWeight ? ` by more than ${pct(minTradeWeight)}` : ""}.`);
  else out.push(`Rebalance to the targets ${SCHEDULE_TEXT[schedule]}.`);
  if (d.entry && d.entry.deployMonths > 0) out.push(`Initial capital is invested in ${d.entry.deployMonths} equal monthly tranches; the undeployed part stays in cash.`);
  if (d.reserve) out.push(`${pct(d.reserve.fraction)} of each contribution is held in cash and invested in ${d.reserve.riskyTicker} when it is more than ${pct(-d.reserve.releaseDrawdown)} below its prior peak.`);
  out.push("Decisions use data through the close; orders fill at the next trading day's close after slippage. Contributions are invested toward the targets without selling.");
  return out;
}
