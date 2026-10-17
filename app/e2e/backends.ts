import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";

/**
 * Every backend StockHub's local server would forward is answered here, in the browser, from
 * fixtures and deterministic synthetic prices: the market data API, RSS, SEC, House Clerk, ARK,
 * OpenFIGI and a mock IBKR gateway. Nothing reaches the network, so the suite runs the same in CI.
 */
const fx = (n: string) => readFileSync(new URL(`../src/quant/fixtures/${n}`, import.meta.url), "utf8");

export const TODAY = "2026-10-16";

function businessDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 864e5) {
    const d = new Date(t);
    if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** A seeded random walk per symbol: the same series every run. */
export function candles(symbol: string, from = "2003-01-01", to = TODAY) {
  let seed = [...symbol].reduce((s, c) => s * 31 + c.charCodeAt(0), 7) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const safe = /^(SHY|BIL|AGG|IEF|TLT|BND)$/.test(symbol);
  let p = 50 + (seed % 100);
  return businessDays(from < "2003-01-01" ? "2003-01-01" : from, to).map((date) => {
    const z = (rnd() + rnd() + rnd() - 1.5) * 2;
    p *= 1 + (safe ? 0.0001 + 0.002 * z : 0.0004 + 0.012 * z);
    return { date, open: p, high: p * 1.01, low: p * 0.99, close: p, volume: 1_000_000 };
  });
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const FORM13F = [
  ...["2026-03-31", "2026-06-30"].flatMap((period, i) => [
    { period_ending: period, issuer: "APPLE INC", cusip: "037833100", asset_class: "COM", security_type: "SH", principal_amount: 300_000_000 - i * 20_000_000, value: 60e9, weight: 0.3 },
    { period_ending: period, issuer: "LENNAR CORP", cusip: "526057104", asset_class: "CL A", security_type: "SH", principal_amount: 7_000_000 + i * 3_000_000, value: 1e9, weight: 0.01 },
  ]),
];

const RSS = `<?xml version="1.0"?><rss><channel><item><title>Markets steady in a quiet session</title><link>https://example.invalid/a</link><pubDate>Thu, 16 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>`;

const emptySubs = { cik: "0", name: "None", filings: { recent: { accessionNumber: [], filingDate: [], acceptanceDateTime: [], form: [], primaryDocument: [] } } };

/** The mock IBKR paper gateway used by the order flow. */
function ibkr(route: Route, path: string, method: string) {
  const pos = (t: string, n: number, px: number, conid: number) => ({ acctId: "DU7654321", conid, contractDesc: t, ticker: t, position: n, mktPrice: px, mktValue: n * px, currency: "USD", avgCost: px * 0.9, avgPrice: px * 0.9, unrealizedPnl: n * px * 0.1, assetClass: "STK" });
  if (path === "/iserver/auth/status") return json(route, { authenticated: true, connected: true, competing: false });
  if (path === "/tickle") return json(route, { session: "x" });
  if (path === "/portfolio/accounts") return json(route, [{ accountId: "DU7654321", accountTitle: "Paper Trading", currency: "USD" }]);
  if (path === "/portfolio/DU7654321/positions/0") return json(route, [pos("SPY", 12, 662.5, 756733), pos("SHY", 20, 82.9, 15547841)]);
  if (path === "/portfolio/DU7654321/summary") return json(route, { netliquidation: { amount: 9608, currency: "USD" }, totalcashvalue: { amount: 0, currency: "USD" } });
  if (path === "/iserver/accounts") return json(route, { accounts: ["DU7654321"] });
  if (path.startsWith("/iserver/account/DU7654321/orders/whatif")) return json(route, { amount: { commission: "1.00 USD" }, equity: { change: "-1" }, initial: { after: "0" } });
  if (path === "/iserver/account/DU7654321/orders" && method === "POST") return json(route, [{ id: "reply-1", message: ["Are you sure you want to submit this order?"] }]);
  if (path === "/iserver/reply/reply-1") return json(route, [{ order_id: "123456", order_status: "PreSubmitted" }]);
  if (path === "/iserver/account/orders") return json(route, { orders: [] });
  return json(route, {}, 404);
}

export async function mockBackends(page: Page) {
  await page.route("**/api/v1/**", (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname.replace("/api/v1", "");
    const sym = u.searchParams.get("symbol") ?? "SPY";
    if (/price\/historical$/.test(p)) return json(route, { results: candles(sym.toUpperCase(), u.searchParams.get("start_date") ?? "2003-01-01") });
    if (p === "/equity/price/quote") return json(route, { results: sym.split(",").map((s) => ({ symbol: s, name: s, last_price: 101, prev_close: 100, open: 100, high: 102, low: 99, volume: 1e6 })) });
    if (p === "/equity/ownership/form_13f") return json(route, { results: FORM13F });
    return json(route, { results: [] });
  });
  await page.route("**/rss/**", (route) => route.fulfill({ status: 200, contentType: "application/rss+xml", body: RSS }));
  await page.route("**/sec/data/submissions/*.json", (route) =>
    route.request().url().includes("CIK0001067983") ? route.fulfill({ status: 200, contentType: "application/json", body: fx("submissions-berkshire.json") }) : json(route, emptySubs));
  await page.route("**/sec/www/**", (route) => {
    const url = route.request().url();
    // the one 13G/A in the Berkshire fixture list; every other filing is answered with the Form 4
    const body = /000119312526417254/.test(url) ? fx("sched13ga-buffett-lennar.xml") : fx("form4-berkshire-lennar.xml");
    return route.fulfill({ status: 200, contentType: "application/xml", body });
  });
  await page.route("**/ark-api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: fx("ark-trades-arkk.json") }));
  await page.route("**/ark-assets/**", (route) => route.fulfill({ status: 200, contentType: "text/csv", body: fx("ark-holdings-arkk.csv") }));
  await page.route("**/figi/**", (route) => {
    const jobs = JSON.parse(route.request().postData() ?? "[]") as { idValue: string }[];
    const map: Record<string, string> = { "037833100": "AAPL", "526057104": "LEN" };
    return json(route, jobs.map((j) => (map[j.idValue] ? { data: [{ ticker: map[j.idValue], exchCode: "US", marketSector: "Equity" }] } : { warning: "No identifier found." })));
  });
  await page.route("**/clerk/**", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/ibkr/v1/api/**", (route) => ibkr(route, new URL(route.request().url()).pathname.replace("/ibkr/v1/api", ""), route.request().method()));
  await page.route("**/llm/**", (route) => route.fulfill({ status: 404, body: "" }));
}

/** Opens a function from the command bar. */
export async function open(page: Page, code: string) {
  const bar = page.locator("input").first();
  await bar.fill(code);
  await bar.press("Enter");
}
