import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
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
