import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const ibkrGateway = process.env.IBKR_GATEWAY_URL ?? "https://localhost:5000";
// Optional Copilot phrasing by Claude: the key stays in this server process and is added by the proxy.
const llmKey = process.env.STOCKHUB_LLM_KEY;
const llmModel = process.env.STOCKHUB_LLM_MODEL ?? "claude-sonnet-5-5";
// SEC EDGAR asks every automated client to identify itself with a name and contact in the User-Agent
// (requests without one are refused). The contact is yours, so it is read from the environment and never stored in the repo.
const secContact = process.env.STOCKHUB_SEC_CONTACT?.trim();
const secUa = secContact ? `StockHub/1 (${secContact})` : null;
const llmUrl = process.env.STOCKHUB_LLM_URL ?? "https://api.anthropic.com";

export default defineConfig({
  // the Broker panel links to the gateway's login page on the same address the proxy uses
  define: {
    "import.meta.env.VITE_IBKR_LOGIN_URL": JSON.stringify(ibkrGateway),
    "import.meta.env.VITE_SEC_CONFIGURED": JSON.stringify(secUa ? "true" : "false"),
    "import.meta.env.VITE_LLM_ENABLED": JSON.stringify(llmKey ? "true" : "false"),
    "import.meta.env.VITE_LLM_MODEL": JSON.stringify(llmModel),
  },
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:6900",
        changeOrigin: true,
      },
      // Public RSS feeds (no API key); proxied because browsers block them via CORS.
      "/rss/yahoo": {
        target: "https://feeds.finance.yahoo.com",
        changeOrigin: true,
        headers: { "User-Agent": "Mozilla/5.0" },
        rewrite: (p) => p.replace(/^\/rss\/yahoo/, "/rss/2.0/headline"),
      },
      // IBKR Client Portal Gateway (read-only use): runs locally with a self-signed certificate.
      // Set IBKR_GATEWAY_URL when it listens somewhere other than https://localhost:5000.
      "/ibkr": {
        target: ibkrGateway,
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/ibkr/, ""),
      },
      // Only the Messages endpoint, and only when a key is configured.
      ...(llmKey ? {
        "/llm/v1/messages": {
          target: llmUrl,
          changeOrigin: true,
          rewrite: () => "/v1/messages",
          headers: { "x-api-key": llmKey, "anthropic-version": "2023-06-01" },
          configure: (proxy) => proxy.on("proxyReq", (req) => { req.removeHeader("origin"); req.removeHeader("referer"); req.removeHeader("cookie"); }),
        },
      } : {}),
      // SEC EDGAR: filing lists (data.sec.gov) and filing documents (www.sec.gov), with the required User-Agent.
      ...(secUa ? {
        "/sec/data": { target: "https://data.sec.gov", changeOrigin: true, headers: { "User-Agent": secUa }, rewrite: (p: string) => p.replace(/^\/sec\/data/, "") },
        "/sec/www": { target: "https://www.sec.gov", changeOrigin: true, headers: { "User-Agent": secUa }, rewrite: (p: string) => p.replace(/^\/sec\/www/, "") },
      } : {}),
      // House Clerk financial disclosures (public, keyless); the Clerk sends no CORS headers.
      "/clerk": {
        target: "https://disclosures-clerk.house.gov",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/clerk/, ""),
      },
      "/rss/google": {
        target: "https://news.google.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/rss\/google/, "/rss/search"),
      },
    },
  },
});
