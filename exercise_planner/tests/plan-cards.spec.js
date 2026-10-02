import { test, expect } from "@playwright/test";
import { memberMe, openPlan, removeMember, signUpMember } from "./member.js";

const exercise = {
  name: "Bicep curls",
  sets: 3,
  reps: "10",
  minutes: 15,
  hold_seconds: null,
  rest_seconds: 60,
};
const activity = (id, title, role, minutes, extra) => ({
  id,
  title,
  role,
  minutes,
  category:
    role === "workout"
      ? "Workout"
      : role === "meal"
        ? "Breakfast"
        : "Skin care",
  time: "08:00",
  calories: role === "meal" ? 500 : 0,
  description: "A practical daily activity.",
  ingredients: [],
  steps: ["Follow the routine"],
  week_note: "Keep a steady pace.",
  ...extra,
});
const sampleTasks = [
  activity("care", "Morning skin care", "care", 5, {
    time: "06:00",
    steps: ["Use 2 finger lengths of sunscreen."],
  }),
  activity("biceps", "Bicep curls", "workout", 15, {
    exercises: [exercise],
    steps: ["Bicep curls: 3 sets of 10 reps"],
  }),
  activity("pushups", "Push-ups", "workout", 15, {
    steps: ["Push-ups: 3 sets of 15 reps", "Rest 60 seconds between sets"],
  }),
  activity("walk", "Brisk walk", "workout", 30, {
    steps: ["Walk for 30 minutes"],
  }),
  activity("breakfast", "Avocado toast", "meal", 10, {
    ingredients: [
      "2 slices whole grain bread",
      "1/2 avocado",
      "1 cup spinach",
      "1 tsp olive oil",
      "Salt to taste",
    ],
  }),
  activity("lunch", "Chickpea salad", "meal", 15, {
    category: "Lunch",
    ingredients: ["1 cup chickpeas", "100 g cucumber"],
  }),
];

async function workspace(page, synthetic) {
  const account = await signUpMember(page);
  const me = memberMe(account, synthetic ? { tasks: sampleTasks } : {});
  const statuses = [];
  await page.route("**/api/progress", (route) =>
    route.fulfill({ json: { statuses, checkins: [], history: [] } }),
  );
  await page.route("**/api/tasks/status", (route) => {
    const body = route.request().postDataJSON();
    const existing = statuses.find(
      (s) => s.date === body.date && s.task_id === body.task_id,
    );
    if (existing) Object.assign(existing, body);
    else statuses.push(body);
    return route.fulfill({ json: body });
  });
  await openPlan(page, me);
}

test.afterEach(({ page }) => removeMember(page));

test("daily cards show totals, sets/reps, portions and tracked completion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await workspace(page, true);
  const daily = page.locator("#daily");
  await expect(daily.locator(".day-total-card.workout")).toContainText(
    "Total workout today",
  );
  await expect(daily.locator(".day-total-card.workout > strong")).toHaveText(
    "1 hr",
  );
  await expect(daily.locator(".activity-card")).toHaveCount(6);
  await expect(daily.locator(".task-time")).toHaveCount(0);
  await expect(daily.locator(".activity-group").first()).toHaveAttribute(
    "aria-label",
    "Workouts",
  );
  const biceps = daily
    .locator(".workout-card")
    .filter({
      has: page.getByRole("heading", { name: "Bicep curls", exact: true }),
    });
  await expect(biceps.locator(".exercise-quantity")).toContainText(
    "3 sets × 10 reps",
  );
  await expect(biceps.locator(".exercise-quantity")).toContainText("15 min");
  await expect(daily.locator(".workout-card").nth(1)).toContainText(
    "3 sets × 15 reps",
  );
  await expect(daily.locator(".meal-card").first()).toContainText(
    "2 slices whole grain bread",
  );
  await expect(daily.locator(".day-total-card.meal > strong")).toHaveText(
    "1,000 kcal",
  );
  await expect(daily.locator(".care-card")).toContainText(
    "2 finger lengths of sunscreen",
  );
  const first = await biceps.boundingBox();
  const second = await daily.locator(".workout-card").nth(1).boundingBox();
  expect(second.x).toBeGreaterThan(first.x);
  expect(second.y).toBe(first.y);

  await biceps
    .getByRole("button", { name: "Mark Bicep curls completed" })
    .click();
  await expect(biceps).toHaveClass(/completed/);
  await expect(daily.locator(".day-total-card.workout")).toContainText(
    "15 min done · 1/3 sessions",
  );
  await daily
    .locator(".workout-card")
    .nth(1)
    .getByRole("button", { name: "Skip", exact: true })
    .click();
  await expect(daily.locator(".workout-card").nth(1)).toHaveClass(/skipped/);
  await expect(daily.locator(".day-total-card.workout > strong")).toHaveText(
    "1 hr",
  );
  await page.reload();
  await expect(daily.locator(".workout-card").first()).toHaveClass(/completed/);
  await daily
    .locator(".meal-card")
    .first()
    .getByRole("button", { name: /more ingredients/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Salt to taste");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await daily.screenshot({ path: "test-results/quantity-cards-desktop.png" });
});

test("existing saved plan exposes workout prescriptions on mobile without regeneration", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await workspace(page, false);
  const daily = page.locator("#daily");
  await expect(daily.locator(".day-total-card.workout > strong")).toHaveText(
    "40 min",
  );
  await expect(
    daily
      .locator(".exercise-quantity")
      .filter({ hasText: "Dumbbell Bicep Curls" }),
  ).toContainText("3 sets × 12 reps");
  await expect(
    daily.locator(".exercise-quantity").filter({ hasText: "Plank" }),
  ).toContainText("3 sets × 30 sec hold");
  await expect(daily.locator(".meal-card").first()).toContainText(
    "2 slices whole grain bread",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await daily.screenshot({ path: "test-results/quantity-cards-mobile.png" });
  await page.getByRole("button", { name: "Workouts", exact: true }).click();
  await expect(daily.locator(".meal-card")).toHaveCount(0);
  await expect(daily.locator(".workout-card")).toHaveCount(2);
  await daily.locator(".task-details-button").nth(1).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Your routine" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Next week" }).click();
  await expect(daily.locator(".calendar-tools")).toContainText("Week 2 of 4");
  await expect(daily.locator(".day-total-card.workout")).toContainText(
    "Total workout for this day",
  );
});
