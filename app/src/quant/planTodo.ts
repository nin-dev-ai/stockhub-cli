/**
 * "What needs doing" for a saved plan: a strategy's signal changed, a rebalance is due under the
 * plan's rule, a holding drifted past 5 points, or a monthly contribution is due. Pure: it reads
 * the portfolio, its original snapshot and the strategies re-run on current data. Each item has a
 * stable key so an alert is raised once. See docs/PRD_phase6.md (P-4).
 */
import { holdingText } from "./cardFacts";
import type { BacktestResult } from "./service";
import { holdingsTable, type PlanSnapshot, type Portfolio } from "./tracking";
import type { Panel } from "./types";

export type TodoKind = "switch" | "drift" | "rebalance" | "contribution";
export interface TodoItem { key: string; kind: TodoKind; title: string; detail: string; date: string }

export const DRIFT_LIMIT = 0.05;

const sorted = (t: Record<string, number>) =>
  Object.entries(t).filter(([k, w]) => k !== "CASH" && w > 0.005).map(([ticker, weight]) => ({ ticker, weight })).sort((a, b) => b.weight - a.weight);
const same = (a: Record<string, number>, b: Record<string, number>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 0.02);
const period = (d: string, rule: string) => (rule === "monthly" ? d.slice(0, 7) : rule === "quarterly" ? `${d.slice(0, 4)}Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}` : d.slice(0, 4));
const RULE_WORD: Record<string, string> = { monthly: "monthly", quarterly: "quarterly", annual: "yearly" };

export function planTodo(a: { portfolio: Portfolio; original: PlanSnapshot; results: BacktestResult[]; targets: Record<string, number>; panel: Panel }): TodoItem[] {
  const { portfolio: p, original, results, targets, panel } = a;
  const lastDate = panel.dates[panel.dates.length - 1];
  if (!lastDate) return [];
  const trades = p.transactions.filter((t) => t.kind === "buy" || t.kind === "sell");
  const lastRebalance = trades.length ? trades.map((t) => t.date).sort().at(-1)! : original.asOf;
  const out: TodoItem[] = [];

  // a strategy's rule changed what it holds since the portfolio last traded
  for (const r of results) {
    if ((original.weights[r.strategy.id] ?? 0) <= 0) continue;
    const reb = r.run.decisions.filter((d) => d.kind === "rebalance");
    for (let i = reb.length - 1; i > 0; i--) {
      if (reb[i].date <= lastRebalance) break;
      if (!same(reb[i - 1].targets, reb[i].targets)) {
        out.push({
          key: `${p.id}:switch:${r.strategy.id}:${reb[i].date}`, kind: "switch", date: reb[i].date,
          title: `${r.strategy.name} moved from ${holdingText(sorted(reb[i - 1].targets))} to ${holdingText(sorted(reb[i].targets))}`,
          detail: `Its rule changed what it holds on ${reb[i].date}. Rebalance to follow the plan.`,
        });
        break;
      }
    }
  }

  const h = holdingsTable(p.transactions, panel, p.mode, targets);
  // a holding the plan no longer wants has a 0% target
  const rows = h.rows.filter((r) => r.weight != null).map((r) => ({ ticker: r.ticker, weight: r.weight!, target: r.target ?? 0 }));
  const drifted = h.total > 0 ? rows.filter((r) => Math.abs(r.weight - r.target) > DRIFT_LIMIT)
    .sort((x, y) => Math.abs(y.weight - y.target) - Math.abs(x.weight - x.target)) : [];
  if (drifted.length) {
    const d = drifted[0], gap = (d.weight - d.target) * 100;
    out.push({
      key: `${p.id}:drift:${lastDate.slice(0, 7)}`, kind: "drift", date: lastDate,
      title: `${d.ticker} is ${Math.abs(gap).toFixed(1)} points ${gap > 0 ? "above" : "below"} its target${drifted.length > 1 ? ` (${drifted.length} holdings past 5 points)` : ""}`,
      detail: `${(d.weight * 100).toFixed(1)}% held against a ${(d.target * 100).toFixed(1)}% target on ${lastDate}.`,
    });
  }

  const rule = original.inputs.rebalance ?? "quarterly";
  const offTarget = rows.some((r) => Math.abs(r.weight - r.target) > 0.005);
  if (RULE_WORD[rule] && h.total > 0 && offTarget && period(lastDate, rule) !== period(lastRebalance, rule)) {
    out.push({
      key: `${p.id}:rebalance:${period(lastDate, rule)}`, kind: "rebalance", date: lastDate,
      title: `The ${RULE_WORD[rule]} rebalance is due`,
      detail: `The plan rebalances ${RULE_WORD[rule]}; the last trades were on ${lastRebalance}.`,
    });
  }

  const monthly = original.inputs.monthly;
  const month = lastDate.slice(0, 7);
  if (monthly > 0 && p.mode !== "broker" && month > original.asOf.slice(0, 7) && !p.transactions.some((t) => t.kind === "contribution" && t.date.slice(0, 7) === month)) {
    out.push({
      key: `${p.id}:contribution:${month}`, kind: "contribution", date: lastDate,
      title: `The $${monthly.toLocaleString("en-US")} monthly contribution for ${month} is due`,
      detail: "The plan assumes a contribution every month; nothing has been recorded this month.",
    });
  }
  return out;
}
