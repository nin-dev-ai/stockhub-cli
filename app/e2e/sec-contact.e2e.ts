import { test, expect } from "@playwright/test";
import { mockBackends, open, TODAY } from "./backends";

// a server started without STOCKHUB_SEC_CONTACT (see playwright.config.ts)
test.use({ baseURL: "http://localhost:5181" });

test("personas: live filings turn on from a contact typed in the app, sent only as a header to the local server", async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00Z`));
  await mockBackends(page);
  const contacts: (string | undefined)[] = [];
  page.on("request", (r) => { if (r.url().includes("/sec/")) contacts.push(r.headers()["x-stockhub-sec-contact"]); });
  await page.goto("/");
  await open(page, "PERS");
  const box = page.getByLabel("Name and email for the SEC");
  await expect(box).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Turn on live filings" })).toBeDisabled();
  expect(contacts).toEqual([]);
  await box.fill("Sam Lee sam@example.com");
  await page.getByRole("button", { name: "Turn on live filings" }).click();
  await expect(page.getByText("Live SEC filings on.")).toBeVisible();
  await expect(page.getByText(/Newest filing: Form 13G\/A · 2026-10-08 05:47 UTC · 8 days ago/)).toBeVisible({ timeout: 60_000 });
  expect(contacts.length).toBeGreaterThan(0);
  expect(new Set(contacts)).toEqual(new Set(["Sam Lee sam@example.com"]));
});
