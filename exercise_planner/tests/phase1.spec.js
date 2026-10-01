import { test, expect } from "@playwright/test";

test("signup, conditional onboarding, persistence and honest planning errors", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const email = `browser.${Date.now()}@example.com`;
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome to Forma." }),
  ).toBeVisible();
  await page.getByLabel("Your name", { exact: true }).fill("Browser Tester");
  await page.getByLabel("Email for notifications").fill(email);
  await page.getByLabel("Password (optional)").fill("BrowserPassword123!");
  await page.getByRole("button", { name: "Create profile" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "What matters to you?" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Skin care", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    dialog.getByRole("button", { name: "Arms", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByLabel("Age", { exact: true })).toHaveValue("29");
  await expect(dialog.getByLabel("Height (cm)")).toHaveValue("175");
  await expect(dialog.getByLabel("Weight (kg)")).toHaveValue("75");
  await expect(dialog.getByLabel("Skin type (optional)")).toHaveValue(
    "Combination",
  );
  await expect(dialog.getByLabel("Hair type (optional)")).toHaveValue("Wavy");
  await dialog.getByLabel("Age", { exact: true }).fill("28");
  await dialog.getByLabel("Height (cm)").fill("172");
  await dialog.getByLabel("Weight (kg)").fill("72.5");
  await dialog.getByLabel("Skin type (optional)").selectOption("Dry");
  await dialog.getByLabel("Start care in week 1").check();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Vegan", exact: true }).click();
  await dialog.getByLabel("Allergies & food exclusions").fill("Peanuts");
  await page.route("**/api/plans/generate", (r) =>
    r.fulfill({
      status: 202,
      json: {
        id: "browser-test-job",
        status: "queued",
        message: "Planning is queued.",
      },
    }),
  );
  await page.route("**/api/jobs/browser-test-job", (r) =>
    r.fulfill({
      json: {
        id: "browser-test-job",
        status: "failed",
        message: "Test provider unavailable. Retry is available.",
      },
    }),
  );
  await dialog.getByRole("button", { name: "Prepare Planning" }).click();
  await expect(
    page.getByRole("heading", { name: "Preparing your four-week plan" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Planning needs another try" }),
  ).toBeVisible({ timeout: 10000 });
  const me = await (await page.request.get("/api/me")).json();
  expect(me.profile.skin_type).toBe("Dry");
  expect(me.profile.care_early).toBe(true);
  expect(me.profile.diet).toEqual(["Vegan"]);
  expect(me.profile.body_areas).toContain("Arms");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "A fresh day, Browser." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  // Remove the temporary tenant through the real administrator API.
  await page.request.post("/api/auth/login", {
    data: { email: "admin@example.com", password: "admin123" },
  });
  expect(
    (await page.request.delete("/api/admin/users/" + me.account.id)).ok(),
  ).toBe(true);
});

test("persistent administrator CRUD, password and impersonation", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Administrator sign in" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Email", { exact: true })
    .fill("admin@example.com");
  await page
    .getByRole("dialog")
    .getByLabel("Password", { exact: true })
    .fill("admin123");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Users", exact: true }),
  ).toBeVisible();
  const email = `admin.browser.${Date.now()}@example.com`;
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Name", { exact: true }).fill("Admin Browser");
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toBeVisible();
  await page.reload();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Set password" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Password", { exact: true })
    .fill("UpdatedPassword123!");
  await page.getByRole("button", { name: "Save password" }).click();
  await row.getByRole("button", { name: "Login as" }).click();
  await expect(
    page.getByRole("button", { name: "Return to admin" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "A fresh day, Admin." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Return to admin" }).click();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(row).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("welcome is responsive without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome to Forma." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/welcome-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/welcome-desktop.png",
    fullPage: true,
  });
});

test("administrator can open personal wellness workspace and keep user management", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Administrator sign in" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email", { exact: true }).fill("admin@example.com");
  await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue(
    "admin@example.com",
  );
  await expect(dialog.getByLabel("Password", { exact: true })).toHaveValue(
    "admin123",
  );
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Users", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /A fresh day/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Users", exact: true }),
  ).toBeVisible();
  expect((await (await page.request.get("/api/me")).json()).account.role).toBe(
    "admin",
  );
});
