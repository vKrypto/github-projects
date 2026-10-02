import fs from "node:fs";
import { expect } from "@playwright/test";
import { localDate, shiftDate } from "../src/api.js";

// Administrators are platform staff without plans, so plan tests run as a
// temporary member whose /api/me is served from a fixture plan starting today.
const SAMPLE_PLAN = JSON.parse(
  fs.readFileSync(new URL("./fixtures/sample-plan.json", import.meta.url)),
);
const SAMPLE_PROFILE = {
  focus: ["Physique", "Overall wellness", "Skin care", "Hair care"],
  body_areas: ["Arms", "Legs", "Torso"],
  custom_area: "Core stability and balanced strength",
  diet: ["Vegetarian"],
  allergies: "None",
  weight: 75,
  height: 175,
  age: 29,
  level: "Beginner",
  goal: "Maintain & feel better",
  skin_type: "Combination",
  hair_type: "Wavy",
  care_early: false,
  equipment: "Gym access with dumbbells, bench, treadmill and cable machine",
  limitations: "No known limitations",
  notifications: false,
  timezone: "Asia/Kolkata",
};
const members = new WeakMap();

export async function signUpMember(page) {
  await page.goto("/");
  const email = `plan.tester.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`;
  const response = await page.request.post("/api/auth/signup", {
    data: { name: "Sample Tester", email, password: "SampleTester123!" },
  });
  expect(response.ok()).toBe(true);
  const { account } = await response.json();
  members.set(page, account.id);
  return account;
}

// `tasks` replaces every day's activities; otherwise the sample plan is used.
export function memberMe(account, { tasks } = {}) {
  const start = localDate();
  const plan = structuredClone(SAMPLE_PLAN);
  plan.days = plan.days.slice(0, 28).map((day, index) => ({
    ...day,
    date: shiftDate(start, index),
    week: Math.floor(index / 7) + 1,
    ...(tasks ? { tasks: structuredClone(tasks) } : {}),
  }));
  plan.start_date = start;
  plan.end_date = shiftDate(start, 27);
  return {
    account,
    profile: { ...SAMPLE_PROFILE, name: account.name, email: account.email },
    plan,
    job: null,
    notifications: [],
    preferences: [],
    impersonating: false,
  };
}

export async function openPlan(page, me) {
  await page.route("**/api/me", (route) => route.fulfill({ json: me }));
  await page.reload();
  await page.locator("#daily").waitFor();
}

export async function removeMember(page) {
  const id = members.get(page);
  if (!id) return;
  members.delete(page);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.request.post("/api/auth/login", {
    data: { email: "admin@example.com", password: "admin123" },
  });
  expect((await page.request.delete("/api/admin/users/" + id)).ok()).toBe(
    true,
  );
}
