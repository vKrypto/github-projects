import { test, expect } from "@playwright/test";
import { memberMe, openPlan, removeMember, signUpMember } from "./member.js";

const exercise = (name, reps, calories) => ({
  name,
  sets: 3,
  reps,
  hold_seconds: null,
  minutes: null,
  rest_seconds: 60,
  calories,
});
const tasks = [
  {
    id: "legs",
    role: "workout",
    category: "Workout",
    time: "07:00",
    title: "Lower Body Strength",
    description: "Legs.",
    minutes: 35,
    calories: 220,
    ingredients: [],
    steps: ["Goblet squats", "Reverse lunges"],
    week_note: "Base",
    exercises: [
      exercise("Goblet Squat", "12", 70),
      exercise("Reverse Lunge", "10 per side", 65),
    ],
  },
  {
    id: "arms",
    role: "workout",
    category: "Workout",
    time: "18:00",
    title: "Biceps and Triceps",
    description: "Arms.",
    minutes: 60,
    calories: 180,
    ingredients: [],
    steps: ["Curls", "Pushdowns"],
    week_note: "Base",
    exercises: [exercise("Hammer Curl", "10", 40)],
  },
  {
    id: "breakfast",
    role: "meal",
    category: "Breakfast",
    time: "08:00",
    title: "Breakfast – Besan Chilla with Curd",
    description: "Savoury pancakes.",
    minutes: 20,
    calories: 420,
    steps: ["Cook."],
    week_note: "Base",
    ingredients: ["1/2 cup besan (~180 kcal, 11 g protein)", "1 cup curd"],
    nutrition: { protein_g: 24, carbs_g: 45, fat_g: 15, fiber_g: 8 },
  },
  {
    id: "lunch",
    role: "meal",
    category: "Lunch",
    time: "13:00",
    title: "Lunch – Dal Tadka with Brown Rice",
    description: "Dal and rice.",
    minutes: 30,
    calories: 620,
    steps: ["Cook."],
    week_note: "Base",
    ingredients: ["1/2 cup toor dal, dry", "1/2 cup brown rice, dry"],
    nutrition: { protein_g: 28, carbs_g: 95, fat_g: 13, fiber_g: 14 },
  },
];

async function signIn(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Administrator sign in" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await page.getByRole("heading", { name: "Users", exact: true }).waitFor();
}

async function workspace(page) {
  const me = memberMe(await signUpMember(page), { tasks });
  for (const day of me.plan.days)
    day.daily_nutrition_targets = {
      protein_g: 95,
      carbs_g: 250,
      fat_g: 60,
      fiber_g: 30,
    };
  await page.evaluate(() => localStorage.removeItem("forma.planView"));
  await openPlan(page, me);
}

test.afterEach(({ page }) => removeMember(page));

test("cards show meal nutrition against targets and estimated exercise burn", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await workspace(page);
  const daily = page.locator("#daily");
  await expect(daily.locator(".day-total-card.meal")).toContainText(
    "52/95 g protein · 140/250 g carbs · 28/60 g fat",
  );
  await expect(daily.locator(".day-total-card.workout")).toContainText(
    "~400 kcal estimated burn",
  );
  await expect(daily.locator(".meal-card").first()).toContainText(
    "24 g protein",
  );
  await expect(
    daily.locator(".exercise-quantity").filter({ hasText: "Goblet Squat" }),
  ).toContainText("~70 kcal");
  await expect(daily.locator(".workout-card").first()).toContainText(
    "total session · ~220 kcal",
  );
});

test("minimal view shows time per body area and only ingredients, and is remembered", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await workspace(page);
  const daily = page.locator("#daily");
  await daily.getByRole("button", { name: "Minimal" }).click();
  await expect(daily.locator(".minimal-card")).toHaveCount(2);
  await expect(daily.locator(".activity-card")).toHaveCount(0);

  const focus = daily.locator(".minimal-focus li");
  await expect(focus).toHaveCount(2);
  await expect(focus.nth(0)).toContainText("Legs");
  await expect(focus.nth(0)).toContainText("35 min");
  await expect(focus.nth(1)).toContainText("Arms");
  await expect(focus.nth(1)).toContainText("1 hr");

  const meals = daily.getByRole("region", { name: "Meal ingredients" });
  await expect(meals).toContainText("1/2 cup toor dal, dry");
  await expect(meals).not.toContainText("Dal Tadka");
  await expect(meals).toContainText("52/95 g protein");

  await page.reload();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(daily.getByRole("button", { name: "Minimal" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await daily.getByRole("button", { name: "Meals", exact: true }).click();
  await expect(daily.locator(".minimal-card")).toHaveCount(1);
  await daily.getByRole("button", { name: "Cards" }).click();
  await expect(daily.locator(".meal-card")).toHaveCount(2);
});

test("admin static pages tab lists every guide page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page);
  await page.getByRole("button", { name: "Static pages", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Static pages" }),
  ).toBeVisible();
  const rows = page.locator(".static-table tbody tr");
  await expect(rows.first()).toBeVisible();
  const exerciseCount = await rows.count();
  expect(exerciseCount).toBeGreaterThan(100);
  await expect(rows.first().locator(".static-video")).toHaveAttribute(
    "href",
    /youtube\.com\/watch\?v=/,
  );
  await page.getByRole("tab", { name: /Foods/ }).click();
  await page.getByRole("searchbox").fill("biryani");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("/food/?q=vegetable-biryani");
  await rows.getByRole("link", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/food\/\?q=vegetable-biryani$/);
  await page.getByRole("link", { name: "Back to plan" }).click();
  await expect(
    page.getByRole("heading", { name: "Static pages" }),
  ).toBeVisible();
});
