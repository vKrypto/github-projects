import { test, expect } from "@playwright/test";
import { shiftDate } from "../src/api.js";
import { memberMe, openPlan, removeMember, signUpMember } from "./member.js";

async function workspace(page) {
  const me = memberMe(await signUpMember(page));
  await page.route("**/api/preferences", (r) =>
    r.fulfill({ json: me.preferences }),
  );
  await page.route("**/api/progress", (r) =>
    r.fulfill({ json: { statuses: [], checkins: [], history: [] } }),
  );
  await openPlan(page, me);
  return me;
}

test.afterEach(({ page }) => removeMember(page));

function update(me, mode, body, id) {
  const original = me.plan;
  const start =
    mode === "extend" ? shiftDate(original.end_date, 1) : original.start_date;
  const segment = Array.from({ length: body.days }, (_, i) => ({
    ...structuredClone(original.days[i % 28]),
    date: shiftDate(start, i),
    tasks: original.days[i % 28].tasks.map((t) => ({
      ...t,
      id: id + ":" + t.id,
      title: "Updated " + t.title,
    })),
  }));
  const change = {
    action: mode,
    days: body.days,
    start_date: start,
    end_date: shiftDate(start, body.days - 1),
    preferences: body.preferences,
  };
  me.plan = {
    ...original,
    days: (mode === "extend"
      ? [...original.days, ...segment]
      : [...segment, ...original.days.slice(body.days)]
    ).map((d, i) => ({ ...d, week: Math.floor(i / 7) + 1 })),
    last_change: change,
  };
  me.plan.end_date = me.plan.days.at(-1).date;
  return change;
}

test("refine dialog sends days and one preference note, then shows reviewed changes and saved preferences", async ({
  page,
}) => {
  const me = await workspace(page);
  let request;
  await page.route("**/api/plans/refine", async (r) => {
    request = r.request().postDataJSON();
    const change = update(me, "refine", request, "refined");
    me.preferences.push({
      id: "pref1",
      text: request.preferences,
      action: "refine",
      days: request.days,
      created: new Date().toISOString(),
    });
    me.job = {
      id: "refine-job",
      action: "refine",
      days: request.days,
      status: "completed",
      message: "Your refined plan is ready.",
    };
    await r.fulfill({
      status: 202,
      json: { ...me.job, status: "queued", start_date: change.start_date },
    });
  });
  await page.route("**/api/jobs/refine-job", (r) =>
    r.fulfill({ json: me.job }),
  );
  await page
    .getByRole("button", { name: "Refine current plan", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await expect(modal.locator("textarea")).toHaveCount(1);
  await modal
    .getByLabel("What would you like to change?")
    .fill("Keep workouts under 30 minutes.");
  await modal.getByLabel("Number of days").selectOption("3");
  await modal.getByRole("button", { name: "Refine plan", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Refining your current plan" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Extend Plan", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".plan-change-summary")).toContainText("refined", {
    timeout: 10000,
  });
  await expect(page.locator(".plan-change-summary")).toContainText("3 days");
  expect(request).toEqual({
    days: 3,
    preferences: "Keep workouts under 30 minutes.",
  });
  expect(me.plan.days).toHaveLength(28);
  await expect(page.locator(".task h3").first()).toContainText("Updated");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".saved-preferences")).toContainText(
    request.preferences,
  );
});

test("extend accepts up to 28 days and the calendar reaches all added weeks on mobile", async ({
  page,
}) => {
  const me = await workspace(page);
  let request;
  await page.route("**/api/plans/extend", async (r) => {
    request = r.request().postDataJSON();
    const change = update(me, "extend", request, "extended");
    me.preferences.push({
      id: "pref2",
      text: request.preferences,
      action: "extend",
      days: request.days,
      created: new Date().toISOString(),
    });
    me.job = {
      id: "extend-job",
      action: "extend",
      days: request.days,
      status: "completed",
      message: "Your extended plan is ready.",
    };
    await r.fulfill({
      status: 202,
      json: { ...me.job, status: "queued", start_date: change.start_date },
    });
  });
  await page.route("**/api/jobs/extend-job", (r) =>
    r.fulfill({ json: me.job }),
  );
  await page.getByRole("button", { name: "Extend Plan", exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(
    modal.getByLabel("Number of days").locator("option"),
  ).toHaveCount(28);
  await modal
    .getByLabel("What would you like to change?")
    .fill("Continue with more meal variety.");
  await modal.getByLabel("Number of days").selectOption("28");
  await modal.getByRole("button", { name: "Extend plan", exact: true }).click();
  await expect(page.locator(".plan-change-summary")).toContainText("extended", {
    timeout: 10000,
  });
  expect(request.days).toBe(28);
  expect(me.plan.days).toHaveLength(56);
  await expect(
    page.getByText("Week 5 of 8", { exact: true }).first(),
  ).toBeVisible();
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "Next week" }).click();
  await expect(
    page.getByText("Week 8 of 8", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Next week" })).toBeDisabled();
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your progress over time" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Refine current plan", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/plan-actions-mobile.png",
    fullPage: true,
  });
});

test("failed extension keeps the visible plan and retry preserves the request", async ({
  page,
}) => {
  const me = await workspace(page);
  const original = structuredClone(me.plan);
  const note = "Use simple meal prep.";
  let body;
  await page.route("**/api/plans/extend", async (r) => {
    body = r.request().postDataJSON();
    me.preferences.push({
      id: "pref3",
      text: body.preferences,
      action: "extend",
      days: body.days,
      created: new Date().toISOString(),
    });
    me.job = {
      id: "failed-job",
      action: "extend",
      days: body.days,
      status: "failed",
      message: "Provider temporarily unavailable",
    };
    await r.fulfill({ status: 202, json: { ...me.job, status: "queued" } });
  });
  await page.route("**/api/jobs/**", async (r) => {
    if (r.request().method() === "POST") {
      const change = update(me, "extend", body, "retry");
      me.job = {
        id: "retry-job",
        action: "extend",
        days: body.days,
        status: "completed",
        message: "Extended plan is ready.",
      };
      return r.fulfill({
        status: 202,
        json: { ...me.job, status: "queued", start_date: change.start_date },
      });
    }
    return r.fulfill({ json: me.job });
  });
  await page.getByRole("button", { name: "Extend Plan", exact: true }).click();
  await page.getByLabel("What would you like to change?").fill(note);
  await page.getByLabel("Number of days").selectOption("2");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Extend plan", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Planning needs another try" }),
  ).toBeVisible({ timeout: 10000 });
  expect(me.plan).toEqual(original);
  await expect(page.locator(".task h3").first()).toHaveText(
    original.days[0].tasks[0].title,
  );
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".plan-change-summary")).toContainText("extended", {
    timeout: 10000,
  });
  expect(me.preferences).toHaveLength(1);
  expect(body).toEqual({ days: 2, preferences: note });
});
