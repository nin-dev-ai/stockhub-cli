import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

// In CI, Playwright's own Chromium (npx playwright install chromium). Locally, the installed Google Chrome
// in its new headless mode, so no browser download is needed.
const LOCAL_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const useLocalChrome = !process.env.CI && existsSync(LOCAL_CHROME);
const PORT = 5179;
/** A second server without STOCKHUB_SEC_CONTACT, for the contact typed into Personas. */
export const NO_CONTACT_PORT = 5181;

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.e2e\.ts$/,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    ...(useLocalChrome ? { headless: false, launchOptions: { executablePath: LOCAL_CHROME, args: ["--headless=new"] } } : {}),
  },
  webServer: [{
    // every backend request is answered by fixtures in the browser (e2e/backends.ts), so nothing here
    // reaches the network; the contact only switches the live-filings feature on
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { STOCKHUB_SEC_CONTACT: "StockHub e2e e2e@example.invalid", STOCKHUB_API_URL: "http://127.0.0.1:9" },
  }, {
    command: `npx vite --port ${NO_CONTACT_PORT} --strictPort`,
    url: `http://localhost:${NO_CONTACT_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { STOCKHUB_SEC_CONTACT: "", STOCKHUB_API_URL: "http://127.0.0.1:9" },
  }],
});
