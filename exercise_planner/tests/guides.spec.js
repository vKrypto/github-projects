import { test, expect } from "@playwright/test";
import { memberMe, openPlan, removeMember, signUpMember } from "./member.js";

const tasks = [
  {
    id: "arms",
    title: "Dumbbell Circuit for Arms and Core",
    role: "workout",
    category: "Workout",
    time: "07:00",
    minutes: 30,
    calories: 120,
    description: "Arms and core.",
    ingredients: [],
    steps: [
      "Dumbbell Bicep Curls: 3 sets of 12 reps",
      "Plank: Hold for 3 sets of 30 seconds",
      "Rest 30 seconds between sets",
    ],
    week_note: "Learn the movements.",
  },
  {
    id: "lunch",
    title: "Lunch – Vegetable Biryani with Raita",
    role: "meal",
    category: "Lunch",
    time: "13:00",
    minutes: 40,
    calories: 650,
    description: "Spiced rice with vegetables.",
    ingredients: ["1 cup basmati rice", "1 cup mixed vegetables"],
    steps: ["Cook the rice.", "Layer with vegetables."],
    week_note: "Balanced meals.",
  },
];

async function workspace(page) {
  await openPlan(page, memberMe(await signUpMember(page), { tasks }));
}

test.afterEach(({ page }) => removeMember(page));

test("card photos open in focus mode and names link to guide pages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await workspace(page);
  const daily = page.locator("#daily");
  const workout = daily.locator(".workout-card");
  await expect(workout.locator(".guide-thumb")).toHaveCount(2);

  await workout
    .getByRole("button", { name: "View 2 photos of Dumbbell Bicep Curl" })
    .click();
  const focus = page.getByRole("dialog", {
    name: "Dumbbell Bicep Curl photos",
  });
  await expect(focus).toContainText("1 of 2");
  await page.keyboard.press("ArrowRight");
  await expect(focus).toContainText("2 of 2");
  await expect(focus.locator(".photo-focus-stage img")).toHaveAttribute(
    "src",
    "/library/exercise/dumbbell-bicep-curl-2.webp",
  );
  await page.keyboard.press("Escape");
  await expect(focus).toHaveCount(0);

  await daily
    .locator(".meal-card")
    .getByRole("button", { name: /photo of Vegetable Biryani/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Vegetable Biryani with Raita photos" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close photos" }).click();

  await workout.getByRole("link", { name: "Dumbbell Bicep Curls" }).click();
  await expect(page).toHaveURL(/\/exercise\/\?q=dumbbell-bicep-curl$/);
  await expect(
    page.getByRole("heading", { name: "Dumbbell Bicep Curl", level: 1 }),
  ).toBeVisible();
  await expect(page.locator(".guide-photos img")).toHaveCount(2);
  await expect(page.locator(".guide-steps li")).toHaveCount(5);
  // The video loads from YouTube only after the viewer presses play.
  await expect(page.locator(".guide-video iframe")).toHaveCount(0);
  await page.getByRole("button", { name: /^Play video:/ }).click();
  await expect(page.locator(".guide-video iframe")).toHaveAttribute(
    "src",
    /^https:\/\/www\.youtube-nocookie\.com\/embed\/[\w-]{11}\?autoplay=1/,
  );

  await page.getByRole("link", { name: "Back to plan" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(workout).toBeVisible();
});

test("guide links work when opened directly", async ({ page }) => {
  await page.goto("/exercise/?q=child's-pose");
  await expect(
    page.getByRole("heading", { name: "Child's Pose", level: 1 }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/exercise\/\?q=childs-pose$/);
  await expect(page.locator(".guide-photos img")).toHaveCount(2);
  await page
    .getByRole("button", { name: /^Enlarge photo/ })
    .first()
    .click();
  await expect(
    page.getByRole("dialog", { name: "Child's Pose photos" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/food/?q=pizza");
  await expect(page.getByRole("status")).toContainText("“pizza”");
  await page.getByRole("searchbox").fill("biryani");
  const cards = page.locator(".guide-card");
  await expect(cards).toHaveCount(1);
  await cards.click();
  await expect(page).toHaveURL(/\/food\/\?q=vegetable-biryani$/);
  await expect(page.locator(".guide-steps li").first()).toBeVisible();
});

test("guide page fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/exercise/?q=bird-dog");
  await expect(page.getByRole("heading", { name: "Bird Dog" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
