/**
 * CUSIP to ticker through OpenFIGI (Bloomberg's open symbology, free; without a key: 10 identifiers per
 * request and 25 requests a minute). 13F filings list CUSIPs only, so this is what lets a fund
 * manager's portfolio be priced and copy-tested.
 */
export const FIGI_BATCH = 10;
/** Bump to re-map after a change in how codes are sent or tickers are written. */
export const FIGI_CACHE_VERSION = 2;

export const figiBatches = (cusips: string[]): string[][] => {
  const uniq = [...new Set(cusips.filter((c) => /^[0-9A-Z]{9}$/i.test(c)).map((c) => c.toUpperCase()))];
  const out: string[][] = [];
  for (let i = 0; i < uniq.length; i += FIGI_BATCH) out.push(uniq.slice(i, i + FIGI_BATCH));
  return out;
};

/** Codes starting with a letter are CINS (companies registered outside the US, such as Chubb); only US listings are asked for. */
export const figiBody = (batch: string[]) => batch.map((idValue) => ({ idType: /^[A-Z]/i.test(idValue) ? "ID_CINS" : "ID_CUSIP", idValue, exchCode: "US" }));

interface FigiRow { ticker?: string; exchCode?: string; marketSector?: string; securityType?: string }

/** Response entries line up with the request; prefer the US composite listing of an equity. Misses map to null. */
export function parseFigi(resp: unknown, batch: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const list = Array.isArray(resp) ? resp : [];
  batch.forEach((cusip, i) => {
    const rows = ((list[i] as { data?: FigiRow[] } | undefined)?.data ?? []).filter((r) => r.ticker);
    const pick = rows.find((r) => r.exchCode === "US" && r.marketSector === "Equity") ?? rows.find((r) => r.exchCode === "US") ?? null;
    // OpenFIGI writes share classes with a space or slash (BRK B, HEI/A); price feeds use a dash
    out[cusip] = pick?.ticker ? pick.ticker.replace(/[\s/]+/g, "-").toUpperCase() : null;
  });
  return out;
}
