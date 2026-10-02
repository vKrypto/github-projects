import test from "node:test";
import assert from "node:assert/strict";
import {
  exerciseQuantity,
  formatDuration,
  nutritionTotals,
  workoutExercises,
} from "./quantities.js";

test("daily duration uses hours without double-counting exercise durations", () => {
  assert.equal(formatDuration(60), "1 hr");
  assert.equal(formatDuration(75), "1 hr 15 min");
  assert.equal(formatDuration(15), "15 min");
  assert.equal(formatDuration(0), "0 min");
});

test("saved circuit exposes each prescription without inventing minutes", () => {
  const exercises = workoutExercises({
    title: "Arms and core",
    minutes: 30,
    steps: [
      "Dumbbell Bicep Curls: 3 sets of 12 reps",
      "Tricep Kickbacks: 3 sets of 12 reps",
      "Plank: Hold for 3 sets of 30 seconds",
      "Rest 30 seconds between sets",
    ],
  });
  assert.deepEqual(
    exercises.map((e) => [e.name, exerciseQuantity(e), e.minutes]),
    [
      ["Dumbbell Bicep Curls", "3 sets × 12 reps", null],
      ["Tricep Kickbacks", "3 sets × 12 reps", null],
      ["Plank", "3 sets × 30 sec hold", null],
    ],
  );
});

test("compact reps, ranges and timed activities keep their units", () => {
  const exercises = workoutExercises({
    title: "Training",
    steps: [
      "Push-ups: 3 x 15",
      "Lunges: 2 sets of 10-12 reps per side",
      "Plank: 3 × 30 seconds",
      "Walking for 15 minutes",
    ],
  });
  assert.deepEqual(exercises.map(exerciseQuantity), [
    "3 sets × 15 reps",
    "2 sets × 10-12 reps per side",
    "3 sets × 30 sec hold",
    "15 min",
  ]);
});

test("rest on a strength step is not shown as its hold duration", () => {
  const exercises = workoutExercises({
    title: "Curls",
    steps: ["Biceps: 3 sets of 10 reps. Rest 60 seconds between sets."],
  });
  assert.equal(exercises[0].hold_seconds, null);
  assert.equal(exerciseQuantity(exercises[0]), "3 sets × 10 reps");
});

test("structured quantities take priority over legacy instruction text", () => {
  const exercises = [
    {
      name: "Biceps",
      sets: 3,
      reps: "10",
      minutes: 15,
      hold_seconds: null,
      rest_seconds: 60,
    },
  ];
  assert.deepEqual(
    workoutExercises({ exercises, steps: ["Biceps: 2 sets of 12 reps"] }),
    exercises,
  );
  assert.equal(exerciseQuantity(exercises[0]), "3 sets × 10 reps");
});

test("unquantified legacy routines keep their instructions rather than fabricate reps", () => {
  assert.deepEqual(
    workoutExercises({
      title: "Mobility",
      minutes: 15,
      steps: ["Follow the routine", "Rest as needed"],
    }),
    [],
  );
});

test("daily nutrition totals add meals that carry nutrition and skip older plans", () => {
  assert.equal(nutritionTotals([{ calories: 500 }, { calories: 300 }]), null);
  assert.deepEqual(
    nutritionTotals([
      { nutrition: { protein_g: 24, carbs_g: 45, fat_g: 15, fiber_g: 8 } },
      { nutrition: { protein_g: 28, carbs_g: 95, fat_g: 13, fiber_g: 14 } },
      { calories: 200 },
    ]),
    { protein_g: 52, carbs_g: 140, fat_g: 28, fiber_g: 22 },
  );
});

test("quantity-first steps name the exercise that follows the numbers", () => {
  const exercises = workoutExercises({
    title: "Core",
    steps: [
      "Perform 3 sets of 15 bird dogs per side.",
      "Perform 3 sets of 20-second front planks.",
      "Perform 3 sets of 12 cable leg curls per leg.",
      "Perform 3 sets of 15 Russian twists (without weight).",
      "Perform 3 sets of 10 slow bird dogs focusing on control.",
      "Warm up with 5 minutes easy treadmill walk.",
      "Perform foam rolling or self-massage if available for 5-10 minutes.",
      "Hold standing calf stretch 30 seconds each leg.",
    ],
  });
  assert.deepEqual(
    exercises.map((e) => [e.name, exerciseQuantity(e)]),
    [
      ["Bird dogs", "3 sets × 15 reps per side"],
      ["Front planks", "3 sets × 20 sec hold"],
      ["Cable leg curls", "3 sets × 12 reps per leg"],
      ["Russian twists", "3 sets × 15 reps"],
      ["Bird dogs", "3 sets × 10 reps"],
      ["Warm up with treadmill walk", "5 min"],
      ["Foam rolling or self-massage", "10 min"],
      ["Standing calf stretch", "30 sec hold"],
    ],
  );
});

test("whole-minute holds read in minutes", () => {
  assert.equal(exerciseQuantity({ hold_seconds: 300 }), "5 min hold");
  assert.equal(
    exerciseQuantity({ sets: 3, hold_seconds: 90 }),
    "3 sets × 90 sec hold",
  );
});
