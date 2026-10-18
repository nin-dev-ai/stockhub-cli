import type { Plugin, ProxyOptions } from "vite";

/**
 * Everything StockHub's local server forwards for the browser, shared by `npm run dev` and
 * `npm run preview` so a built copy behaves like the dev server. Optional features are driven by
 * environment variables (see .env.example); secrets stay in this server process.
 */
export interface StockhubEnv {
  ibkrGateway: string;
  secUa: string | null;
  llmKey: string | null;
  llmModel: string;
  llmUrl: string;
  apiTarget: string;
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): StockhubEnv {
  const secContact = env.STOCKHUB_SEC_CONTACT?.trim();
  return {
    ibkrGateway: env.IBKR_GATEWAY_URL ?? "https://localhost:5000",
    // SEC EDGAR refuses automated requests without a name and contact in the User-Agent
    secUa: secContact ? `StockHub/1 (${secContact})` : null,
    llmKey: env.STOCKHUB_LLM_KEY?.trim() || null,
    llmModel: env.STOCKHUB_LLM_MODEL ?? "claude-sonnet-5-5",
    llmUrl: env.STOCKHUB_LLM_URL ?? "https://api.anthropic.com",
    apiTarget: env.STOCKHUB_API_URL ?? "http://127.0.0.1:6900",
  };
}

/** The browser sends a contact typed into Personas in this header; the proxy turns it into the SEC User-Agent and drops it. */
export const SEC_CONTACT_HEADER = "x-stockhub-sec-contact";

/** A usable contact: a name and an email address on one line, under 120 characters. */
export function validSecContact(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > 120 || /[\r\n]/.test(s) || !/[^\s@]+@[^\s@]+\.[^\s@]+/.test(s)) return null;
  return s;
}

/** The SEC User-Agent for one request: the environment's contact, else the one the browser sent, else none. */
export const secUserAgent = (e: Pick<StockhubEnv, "secUa">, headerValue: unknown): string | null => {
  if (e.secUa) return e.secUa;
  const c = validSecContact(Array.isArray(headerValue) ? headerValue[0] : headerValue);
  return c ? `StockHub/1 (${c})` : null;
};

const strip = (prefix: string, to = "") => (p: string) => p.replace(new RegExp(`^${prefix}`), to);
const BROWSER_UA = { "User-Agent": "Mozilla/5.0 (compatible; StockHub)" };

function secProxy(e: StockhubEnv, target: string, prefix: string): ProxyOptions {
  return {
    target, changeOrigin: true, rewrite: strip(prefix),
    ...(e.secUa ? { headers: { "User-Agent": e.secUa } } : {}),
    bypass: (req) => (secUserAgent(e, req.headers[SEC_CONTACT_HEADER]) ? undefined : false),
    configure: (proxy) => proxy.on("proxyReq", (out, req) => {
      const ua = secUserAgent(e, req.headers[SEC_CONTACT_HEADER]);
      if (ua) out.setHeader("User-Agent", ua);
      for (const h of [SEC_CONTACT_HEADER, "cookie", "origin", "referer"]) out.removeHeader(h);
    }),
  };
}

/** Proxy table. Prefixes must not begin with one another, because Vite matches by prefix. */
export function proxyTable(e: StockhubEnv): Record<string, ProxyOptions> {
  return {
    "/api": { target: e.apiTarget, changeOrigin: true },
    // public RSS feeds (no key); Yahoo requires a browser User-Agent
    "/rss/yahoo": { target: "https://feeds.finance.yahoo.com", changeOrigin: true, headers: { "User-Agent": "Mozilla/5.0" }, rewrite: strip("/rss/yahoo", "/rss/2.0/headline") },
    "/rss/google": { target: "https://news.google.com", changeOrigin: true, rewrite: strip("/rss/google", "/rss/search") },
    // IBKR Client Portal Gateway on this computer, self-signed certificate
    "/ibkr": { target: e.ibkrGateway, changeOrigin: true, secure: false, rewrite: strip("/ibkr") },
    // House Clerk financial disclosures (public, no CORS headers)
    "/clerk": { target: "https://disclosures-clerk.house.gov", changeOrigin: true, rewrite: strip("/clerk") },
    // ARK daily trades (third-party feed) and ARK's own holdings files
    "/ark-api": { target: "https://arkfunds.io", changeOrigin: true, headers: BROWSER_UA, rewrite: strip("/ark-api") },
    "/ark-assets": { target: "https://assets.ark-funds.com", changeOrigin: true, headers: BROWSER_UA, rewrite: strip("/ark-assets") },
    // OpenFIGI: CUSIP to ticker (free, no key)
    "/figi": { target: "https://api.openfigi.com", changeOrigin: true, rewrite: strip("/figi") },
    // SEC EDGAR with the User-Agent it requires: from STOCKHUB_SEC_CONTACT, or from a contact typed into Personas;
    // without either the request is answered 404 here and never reaches the SEC
    "/sec/data": secProxy(e, "https://data.sec.gov", "/sec/data"),
    "/sec/www": secProxy(e, "https://www.sec.gov", "/sec/www"),
    // Claude phrasing: only the Messages endpoint, only with a key; the key is added here, never sent to the browser
    ...(e.llmKey ? {
      "/llm/v1/messages": {
        target: e.llmUrl, changeOrigin: true, rewrite: () => "/v1/messages",
        headers: { "x-api-key": e.llmKey, "anthropic-version": "2023-06-01" },
        configure: (proxy) => proxy.on("proxyReq", (req) => { req.removeHeader("origin"); req.removeHeader("referer"); req.removeHeader("cookie"); }),
      },
    } : {}),
  };
}

/** Build-time flags the browser code reads (never secrets). */
export const defines = (e: StockhubEnv) => ({
  "import.meta.env.VITE_IBKR_LOGIN_URL": JSON.stringify(e.ibkrGateway),
  "import.meta.env.VITE_SEC_CONFIGURED": JSON.stringify(e.secUa ? "true" : "false"),
  "import.meta.env.VITE_LLM_ENABLED": JSON.stringify(e.llmKey ? "true" : "false"),
  "import.meta.env.VITE_LLM_MODEL": JSON.stringify(e.llmModel),
});

/** One line per optional feature, printed when the dev or preview server starts. */
export function featureLines(e: StockhubEnv): string[] {
  return [
    `Live SEC filings: ${e.secUa ? "on" : "off (set STOCKHUB_SEC_CONTACT=\"Your Name you@example.com\")"}`,
    `IBKR gateway: ${e.ibkrGateway}${e.ibkrGateway.includes(":5000") ? " (on a Mac, port 5000 is AirPlay; see README)" : ""}`,
    `Claude wording for the Copilot: ${e.llmKey ? `on (${e.llmModel})` : "off (set STOCKHUB_LLM_KEY)"}`,
    `Market data API: ${e.apiTarget}`,
  ];
}

export function featureBanner(e: StockhubEnv): Plugin {
  const print = () => { for (const l of featureLines(e)) console.log(`  StockHub · ${l}`); };
  return { name: "stockhub-features", configureServer: () => print(), configurePreviewServer: () => print() };
}
