import { ARK_FUNDS, parseArkTrades, parseHoldingsDate, summarizeArk, type ArkFeed } from "@/quant/ark";

/** Proxied by the dev server: `/ark-api` to arkfunds.io, `/ark-assets` to ARK's own file host. */
export async function fetchArkFeed(days = 30, now = new Date(), fetcher: typeof fetch = fetch): Promise<ArkFeed> {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - days * 864e5).toISOString().slice(0, 10);
  const failed: string[] = [];
  const perFund = await Promise.all(ARK_FUNDS.map(async (f) => {
    try {
      const res = await fetcher(`/ark-api/api/v2/etf/trades?symbol=${f}&date_from=${from}&date_to=${to}`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(String(res.status));
      return parseArkTrades(await res.json());
    } catch { failed.push(f); return []; }
  }));
  let holdingsDate: string | null = null;
  try {
    const res = await fetcher("/ark-assets/fund-documents/funds-etf-csv/ARK_INNOVATION_ETF_ARKK_HOLDINGS.csv", { signal: AbortSignal.timeout(15_000) });
    if (res.ok) holdingsDate = parseHoldingsDate(await res.text());
  } catch { /* the trades are still useful without the cross-check date */ }
  if (failed.length === ARK_FUNDS.length) throw new Error("The ARK trade feed could not be reached.");
  return summarizeArk(perFund.flat(), holdingsDate, failed, now.toISOString());
}
