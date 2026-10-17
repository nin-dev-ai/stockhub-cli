/**
 * Which persona filings to alert on: filings accepted after the newest one the user has seen for that
 * persona that contain a purchase, a sale or a stake report (grants, tax withholding, option exercises
 * and gifts are not announced), one alert per filing (a Form 4 can hold several rows), never twice. Pure.
 */
import type { PersonaTrade } from "./personas";

export interface Alert { key: string; personaId: string; title: string; body: string; accepted: string }

const money = (v: number) => (Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v).toLocaleString("en-US")}`);

export function alertText(name: string, rows: PersonaTrade[]): { title: string; body: string } {
  const first = rows[0];
  const form = first.form?.replace("SCHEDULE ", "") ?? "Filing";
  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const action = first.action.charAt(0).toLowerCase() + first.action.slice(1);
  const what = rows.length === 1 ? action : `${rows.length} transactions, latest ${action}`;
  return {
    title: `${name}: new ${form === "4" ? "Form 4" : form}`,
    body: `${what}${first.symbol ? ` of ${first.symbol}` : ` in ${first.asset.split(" · ")[0]}`}${total > 0 ? ` (${money(total)})` : ""}${first.detail && first.category === "stake" ? ` · ${first.detail.split(" · ")[0]}` : ""}`,
  };
}

/** New filings for one persona: accepted after `seen`, not yet notified, newest first. */
export function newAlerts(personaId: string, name: string, events: PersonaTrade[], seen: string | undefined, notified: Set<string>): Alert[] {
  if (seen == null) return [];
  const byFiling = new Map<string, PersonaTrade[]>();
  for (const e of events) {
    if (!e.accepted || e.accepted <= seen) continue;
    const key = e.url ?? `${personaId}|${e.accepted}`;
    if (notified.has(key)) continue;
    byFiling.set(key, [...(byFiling.get(key) ?? []), e]);
  }
  return [...byFiling.entries()]
    .map(([key, rows]) => [key, rows.filter((r) => r.side === "buy" || r.side === "sell" || r.category === "stake")] as const)
    .filter(([, rows]) => rows.length > 0)
    .map(([key, rows]) => ({ key, personaId, accepted: rows[0].accepted!, ...alertText(name, rows) }))
    .sort((a, b) => b.accepted.localeCompare(a.accepted));
}

export const MAX_NOTIFIED = 500;
/** At most this many notifications at once; the rest are summed up in one more. */
export const MAX_AT_ONCE = 4;

/** Notifications to show for a batch: up to MAX_AT_ONCE, then one that counts the rest. */
export function batchNotifications(alerts: Alert[]): { title: string; body: string; tag: string }[] {
  const shown = alerts.slice(0, MAX_AT_ONCE).map((a) => ({ title: a.title, body: a.body, tag: a.key }));
  const rest = alerts.length - shown.length;
  if (rest > 0) shown.push({ title: `${rest} more new filing${rest === 1 ? "" : "s"}`, body: "Open Personas in StockHub to see them.", tag: `more-${alerts[MAX_AT_ONCE].key}` });
  return shown;
}
export const titleWithCount = (base: string, n: number) => (n > 0 ? `(${n}) ${base}` : base);
