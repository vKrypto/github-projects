import { test, expect } from "@playwright/test";
import fs from "node:fs";
const verificationPath = "backend/data/verification.json";
test("live generated plan: tracking, four weeks, details, water, photos and progress", async ({
  page,
}) => {
  test.skip(
    !fs.existsSync(verificationPath),
    "Run the live planning verification first.",
  );
  const v = JSON.parse(fs.readFileSync(verificationPath, "utf8"));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("button", { name: "Administrator sign in" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Email", { exact: true })
    .fill(v.email);
  await page
    .getByRole("dialog")
    .getByLabel("Password", { exact: true })
    .fill(v.password);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A fresh day, Phase." }),
  ).toBeVisible();
  await expect(page.getByText("Reviewed plan · gpt-4.1-mini")).toBeVisible();
  const me = await (await page.request.get("/api/me")).json();
  const tracking = await (await page.request.get("/api/progress")).json();
  for (const s of tracking.statuses)
    await page.request.put("/api/tasks/status", {
      data: { date: s.date, task_id: s.task_id, status: "pending" },
    });
  await page.request.put("/api/checkins", {
    data: { date: me.plan.start_date, water: 0, weight: null, notes: "" },
  });
  await page.reload();
  await expect(page.locator(".task").first()).toBeVisible();
  await page.screenshot({
    path: "test-results/live-dashboard-desktop.png",
    fullPage: true,
  });
  const first = page.locator(".task").first();
  const title = await first.locator("h3").textContent();
  await first.getByRole("button", { name: `Mark ${title} completed` }).click();
  await expect(first).toHaveClass(/completed/);
  await expect(page.getByText(/1 of \d+ activities completed/)).toBeVisible();
  await page.reload();
  await expect(page.locator(".task").first()).toHaveClass(/completed/);
  await page
    .locator(".task")
    .nth(1)
    .getByRole("button", { name: "Skip", exact: true })
    .click();
  await expect(page.locator(".task").nth(1)).toHaveClass(/skipped/);
  await page.getByRole("button", { name: "Log 3 glasses" }).click();
  await expect(page.getByText("3 glasses logged today")).toBeVisible();
  await page.locator(".task-details-button").first().click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Your routine" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Care routines", exact: false })
    .click();
  await expect(page.getByText(/Care begins on day 15/)).toBeVisible();
  await page.getByRole("button", { name: "Next week" }).click();
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(page.locator(".task")).not.toHaveCount(0);
  await expect(
    page.locator(".task-meta").getByText("Skin care", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(
    page.getByText("Week 4 of 4", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Next week" })).toBeDisabled();
  await page.getByRole("button", { name: "My calendar", exact: true }).click();
  await page.getByRole("button", { name: "Add check-in" }).click();
  await page.getByLabel("Weight (kg, optional)").fill("74.5");
  await page.getByLabel("How are you feeling?").fill("Good energy today");
  // Valid one-pixel PNG; the backend decodes and re-encodes it.
  await page
    .getByLabel("Progress photos (optional)")
    .setInputFiles({
      name: "progress.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await page.getByRole("button", { name: "Save check-in" }).click();
  await expect(page.getByText("Your daily check-in is saved.")).toBeVisible();
  await page.getByRole("button", { name: "Share feedback" }).click();
  await page
    .getByRole("dialog")
    .locator("textarea")
    .fill("Prefer more variety at breakfast.");
  await page.getByRole("button", { name: "Save feedback" }).click();
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your four-week progress" }),
  ).toBeVisible();
  await expect(
    page.locator(".weight-history").getByText("74.5 kg", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".photo-grid img").first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.locator(".task")).not.toHaveCount(0);
  await page.screenshot({
    path: "test-results/live-dashboard-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
