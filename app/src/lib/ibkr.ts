import {
  gatewayState, normalizeAccounts, normalizePositions, normalizeSummary,
  type BrokerAccount, type BrokerPosition, type BrokerSummary, type GatewayState,
} from "@/quant/ibkr";

/**
 * Read-only client for the IBKR Client Portal Gateway, reached through the `/ibkr` Vite proxy
 * (the gateway serves HTTPS on localhost with a self-signed certificate). Only the GET endpoints
 * below and the session keep-alive are allowed; any other path, and any other method, throws before
 * a request is made. There is no order endpoint in this module by design.
 */
export const IBKR_BASE = "/ibkr/v1/api";
const ALLOWED: { method: "GET" | "POST"; path: RegExp }[] = [
  { method: "GET", path: /^\/iserver\/auth\/status$/ },
  { method: "POST", path: /^\/tickle$/ },
  { method: "GET", path: /^\/portfolio\/accounts$/ },
  { method: "GET", path: /^\/portfolio\/[A-Za-z0-9]+\/positions\/\d+$/ },
  { method: "GET", path: /^\/portfolio\/[A-Za-z0-9]+\/summary$/ },
];

export class ReadOnlyViolation extends Error {}
const TIMEOUT_MS = 8000;

/** Throws unless the request is one of the read-only calls above. */
export function assertReadOnly(method: string, path: string) {
  if (!ALLOWED.some((a) => a.method === method && a.path.test(path))) throw new ReadOnlyViolation(`Blocked ${method} ${path}: StockHub's IBKR connection is read-only.`);
}

async function call(method: "GET" | "POST", path: string, fetcher: typeof fetch = fetch): Promise<unknown> {
  assertReadOnly(method, path);
  // something else on the port (macOS AirPlay Receiver listens on 5000) can hang instead of refusing
  const res = await fetcher(`${IBKR_BASE}${path}`, { method, headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 401) throw Object.assign(new Error("The IBKR session is not logged in."), { status: 401 });
  if (!res.ok) throw Object.assign(new Error(`IBKR returned ${res.status} for ${path}.`), { status: res.status });
  return res.json();
}

/** Gateway state; a proxy error (nothing listening) reads as offline. */
export async function ibkrStatus(fetcher: typeof fetch = fetch): Promise<GatewayState> {
  try {
    return gatewayState(await call("GET", "/iserver/auth/status", fetcher));
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401) return { kind: "login", detail: "The gateway is running but not logged in." };
    if ((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") return { kind: "offline", detail: "Nothing answered in time on the gateway port. On a Mac, AirPlay Receiver uses port 5000: give the gateway another port." };
    return { kind: "offline", detail: status ? `The proxy answered ${status}; is the gateway running on the configured port?` : "No gateway answered." };
  }
}

export const ibkrTickle = (fetcher: typeof fetch = fetch) => call("POST", "/tickle", fetcher);

export async function ibkrAccounts(fetcher: typeof fetch = fetch): Promise<BrokerAccount[]> {
  return normalizeAccounts(await call("GET", "/portfolio/accounts", fetcher));
}

/** All positions: the endpoint pages 100 at a time. */
export async function ibkrPositions(accountId: string, fetcher: typeof fetch = fetch): Promise<BrokerPosition[]> {
  const out: BrokerPosition[] = [];
  for (let page = 0; page < 20; page++) {
    const raw = await call("GET", `/portfolio/${encodeURIComponent(accountId)}/positions/${page}`, fetcher);
    const rows = Array.isArray(raw) ? raw : [];
    out.push(...normalizePositions(rows));
    if (rows.length < 100) break;
  }
  return out;
}

export async function ibkrSummary(accountId: string, fetcher: typeof fetch = fetch): Promise<BrokerSummary> {
  return normalizeSummary(await call("GET", `/portfolio/${encodeURIComponent(accountId)}/summary`, fetcher));
}
