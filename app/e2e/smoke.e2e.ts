import { test, expect, type Page } from "@playwright/test";
import { mockBackends, open, TODAY } from "./backends";

/** Page errors and console errors, except failed resource loads (404s from optional sources are expected). */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00Z`));
  await mockBackends(page);
});

const SCREENS = ["CC", "AAPL GP", "STRAT", "LAB", "PERS", "PORT", "ORD", "HELP"];

for (const width of [1440, 1024]) {
  test(`every screen loads without errors or horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = watchErrors(page);
    await page.goto("/");
    for (const code of SCREENS) {
      await open(page, code);
      await page.waitForTimeout(1200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${code} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    }
    // the quick bar scrolls on narrow screens by design, but must fit on a laptop-width screen
    if (width >= 1440) {
      const bar = await page.getByTestId("quickbar").evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(bar, `quick bar overflows by ${bar}px`).toBeLessThanOrEqual(1);
    }
    expect(errors).toEqual([]);
  });
}

test("plan: three S&P 500 strategies are flagged, Build me a plan proposes a mix that passes its own checks", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await open(page, "STRAT");
  await expect(page.getByText(/shared dataset/)).toBeVisible({ timeout: 60_000 });
  // every card states its trade-off and what it holds today; buy-and-hold SPY is the yardstick
  await expect(page.getByText(/^The yardstick: every strategy is compared with buying and holding SPY\.$/)).toHaveCount(1, { timeout: 60_000 });
  await expect(page.getByText(/^Today:/).first()).toBeVisible();
  for (const q of ["Buy and hold", "200-day moving average", "Golden cross"]) {
    await page.getByPlaceholder("Search strategies").fill(q);
    await page.getByTitle("Add to basket").first().click();
  }
  await page.getByText("Open in Lab").click();
  await expect(page.getByText("Does this plan make sense?")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/do almost the same thing/).first()).toBeVisible();
  await page.getByRole("button", { name: "Build me a plan" }).first().click();
  await page.getByRole("button", { name: "Use this plan" }).waitFor({ timeout: 90_000 });
  await expect(page.getByText(/Picked again using only the years before/)).toBeVisible();
  await page.getByRole("button", { name: "Use this plan" }).click();
  await expect(page.getByText(/The sleeves cover \d different jobs/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/do almost the same thing/)).toHaveCount(0);
  // guided save: one click runs the projection and opens the named drawer, Enter saves and opens My Portfolio
  await page.getByRole("button", { name: "Save Plan" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Balanced plan, 30% fall limit", { timeout: 90_000 });
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(page.getByText("Balanced plan, 30% fall limit").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Plan vs Observed" })).toBeVisible();
  await expect(page.getByText("What needs doing")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Alert me when a plan needs something")).toBeVisible();
  expect(errors).toEqual([]);
});

test("copilot: unknown messages get help, plan requests get a card that only proposes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /copilot/i }).first().click();
  const ask = async (q: string) => { const i = page.getByLabel("Ask the Copilot"); await i.fill(q); await i.press("Enter"); };
  await ask("hello there");
  await expect(page.getByText("What I can help with").last()).toBeVisible();
  await expect(page.getByText("Answer withheld")).toHaveCount(0);
  await ask("build me a plan with a 25% fall limit");
  await expect(page.getByRole("button", { name: /Test the catalog and propose a plan \(25% limit\)/ })).toBeVisible();
  await ask("place an order for 10 SPY");
  await expect(page.getByRole("button", { name: "Open Paper Orders" }).last()).toBeVisible();
});

test("personas: live SEC filings show their acceptance time and freshness", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await open(page, "PERS");
  await expect(page.getByText(/Newest filing: Form 13G\/A · 2026-10-08 05:47 UTC · 8 days ago/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Open-market purchase").first()).toBeVisible();
  await expect(page.getByText("10-06 05:02").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("paper orders: preview, confirm, answer IBKR's question, then the kill switch stops everything", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("stockhub-portfolios", JSON.stringify({ state: {
      portfolios: [{ id: "pf_e2e", name: "60/40 plan", mode: "broker", baseCurrency: "USD", createdAt: "2026-10-01T00:00:00Z", snapshotIds: ["snap1"], transactions: [] }],
      snapshots: [{ id: "snap1", kind: "original", portfolioId: "pf_e2e", createdAt: "2026-10-01T00:00:00Z", targets: { SPY: 0.6, SHY: 0.4 } }],
      selectedId: null }, version: 0 }));
  });
  await page.goto("/");
  await open(page, "ORD");
  await expect(page.getByText("Rebalance to plan")).toBeVisible({ timeout: 30_000 });
  const preview = page.getByRole("button", { name: "Preview with IBKR" }).first();
  await preview.click();
  await page.getByRole("button", { name: "Send…" }).first().click();
  await page.getByRole("button", { name: "Confirm and send" }).first().click();
  await expect(page.getByText("Are you sure you want to submit this order?").first()).toBeVisible();
  await page.getByRole("button", { name: "Yes, send it" }).click();
  await expect(page.getByText(/Placed: order 123456/)).toBeVisible();
  await page.getByRole("button", { name: /Kill switch/ }).click();
  await expect(page.getByText("Trading is switched off. Nothing can be sent until you turn it back on.")).toBeVisible();
  await expect(page.getByText(/broker question/).first()).toBeVisible();
});
