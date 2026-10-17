import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defines, featureBanner, proxyTable, readEnv } from "./stockhub.config";

// The proxy table and feature flags live in stockhub.config.ts so `npm run preview` serves a built copy
// with the same data sources as `npm run dev`. Settings come from the shell or a local, uncommitted
// app/.env (see .env.example); the shell wins.
export default defineConfig(({ mode }) => {
  const env = readEnv({ ...loadEnv(mode, process.cwd(), ""), ...process.env });
  return {
    define: defines(env),
    plugins: [react(), featureBanner(env)],
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    server: { port: 5173, strictPort: false, proxy: proxyTable(env) },
    preview: { port: 4173, strictPort: false, proxy: proxyTable(env) },
  };
});
