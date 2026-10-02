import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  exerciseRowGuides,
  findGuides,
  guideHref,
  prepareLibrary,
  resolveGuide,
  slug,
  taskGuides,
  workoutFocus,
} from "./library.js";
import { workoutExercises } from "./quantities.js";

const PUBLIC = new URL("../public/", import.meta.url);
const read = (type) =>
  JSON.parse(readFileSync(new URL(`library/${type}.json`, PUBLIC)));
const exercises = prepareLibrary(read("exercise"));
const foods = prepareLibrary(read("food"));
const ids = (guides) => guides.map((g) => g.id);

// Every meal title in the saved plans when the food mapping was curated.
const CURRENT_MEALS = [
  ["Breakfast - Avocado Toast with Tomato & Spinach", "avocado-toast"],
  ["Breakfast - Chia Pudding with Almond Milk and Fresh Fruit", "chia-pudding"],
  [
    "Breakfast - Greek Yogurt Parfait with Granola and Fresh Fruit",
    "greek-yogurt-parfait",
  ],
  [
    "Breakfast - Multigrain Toast with Peanut Butter and Chia Seeds",
    "peanut-butter-toast",
  ],
  ["Breakfast - Oatmeal with Banana, Walnuts, and Honey", "oatmeal"],
  [
    "Breakfast - Smoothie Bowl with Greek Yogurt, Mixed Berries and Nuts",
    "smoothie-bowl",
  ],
  [
    "Breakfast - Whole Wheat Pancakes with Berry Compote",
    "whole-wheat-pancakes",
  ],
  ["Breakfast – Chia Pudding with Mango and Coconut", "chia-pudding"],
  ["Breakfast – Cottage Cheese and Berry Toast", "cottage-cheese-toast"],
  [
    "Breakfast – Greek Yogurt Parfait with Mango and Flaxseeds",
    "greek-yogurt-parfait",
  ],
  ["Breakfast – Oatmeal with Apple, Cinnamon and Walnuts", "oatmeal"],
  ["Breakfast – Peanut Butter Banana Toast", "peanut-butter-toast"],
  [
    "Breakfast – Smoothie Bowl with Spinach, Banana and Chia Seeds",
    "smoothie-bowl",
  ],
  ["Breakfast – Veggie Omelette with Whole Wheat Toast", "veggie-omelette"],
  [
    "Dinner - Grilled Eggplant with Tomato and Feta Salad",
    "grilled-eggplant-feta",
  ],
  [
    "Dinner - Grilled Vegetable and Paneer Skewers with Brown Rice",
    "paneer-skewers",
  ],
  ["Dinner - Spinach and Mushroom Whole Wheat Pasta", "spinach-mushroom-pasta"],
  [
    "Dinner - Stuffed Bell Peppers with Brown Rice and Vegetables",
    "stuffed-bell-peppers",
  ],
  ["Dinner - Tofu Stir Fry with Broccoli and Bell Peppers", "tofu-stir-fry"],
  [
    "Dinner - Vegetable and Lentil Soup with Whole Grain Bread",
    "lentil-vegetable-soup",
  ],
  [
    "Dinner - Zucchini Noodles with Pesto and Cherry Tomatoes",
    "zucchini-noodles-pesto",
  ],
  ["Dinner – Grilled Vegetable and Halloumi Salad", "halloumi-salad"],
  ["Dinner – Lentil and Vegetable Stir Fry with Brown Rice", "lentil-rice"],
  ["Dinner – Mushroom and Pea Stir Fry with Quinoa", "mushroom-pea-quinoa"],
  [
    "Dinner – Stuffed Bell Peppers with Lentils and Vegetables",
    "stuffed-bell-peppers",
  ],
  ["Dinner – Tofu and Vegetable Skewers with Brown Rice", "tofu-skewers"],
  ["Dinner – Vegetable Pasta with Tomato Basil Sauce", "tomato-basil-pasta"],
  ["Dinner – Vegetable and Tofu Stir Fry with Millet", "tofu-stir-fry"],
  ["Lunch - Chickpea and Quinoa Salad", "chickpea-quinoa-salad"],
  ["Lunch - Falafel Salad Bowl with Tahini Dressing", "falafel-bowl"],
  ["Lunch - Lentil and Vegetable Stir-Fry with Brown Rice", "lentil-rice"],
  ["Lunch - Mediterranean Chickpea Wraps", "chickpea-wrap"],
  ["Lunch - Sweet Potato and Black Bean Buddha Bowl", "buddha-bowl"],
  ["Lunch - Vegetable Biryani with Raita", "vegetable-biryani"],
  ["Lunch - Vegetable and Paneer Curry with Brown Rice", "paneer-curry"],
  [
    "Lunch – Chickpea Salad with Quinoa and Mixed Greens",
    "chickpea-quinoa-salad",
  ],
  ["Lunch – Mixed Vegetable and Paneer Curry with Millet", "paneer-curry"],
  ["Lunch – Paneer and Mixed Vegetable Wrap", "paneer-wrap"],
  ["Lunch – Rajma (Kidney Bean) Curry with Brown Rice", "rajma"],
  ["Lunch – Spinach and Chickpea Curry with Brown Rice", "chana-palak"],
  ["Lunch – Vegetable Biryani with Raita", "vegetable-biryani"],
  [
    "Lunch – Vegetable and Lentil Soup with Whole Wheat Roll",
    "lentil-vegetable-soup",
  ],
  ["Snack - Apple Slices with Peanut Butter", "fruit-nut-butter"],
  ["Snack - Banana with Almond Butter", "fruit-nut-butter"],
  ["Snack - Carrot and Cucumber Sticks with Hummus", "veggie-sticks-hummus"],
  ["Snack - Cottage Cheese with Pineapple", "cottage-cheese-pineapple"],
  ["Snack - Roasted Chickpeas", "roasted-chickpeas"],
  ["Snack - Trail Mix with Nuts and Dried Fruits", "trail-mix"],
  ["Snack - Yogurt with Mixed Seeds and Berries", "yogurt-berries"],
  ["Snack – Apple with Almond Butter", "fruit-nut-butter"],
  ["Snack – Carrot sticks with Hummus", "veggie-sticks-hummus"],
  ["Snack – Cottage Cheese and Pineapple", "cottage-cheese-pineapple"],
  ["Snack – Greek Yogurt with Mixed Berries and Nuts", "yogurt-berries"],
  ["Snack – Mixed Nuts and Raisins", "trail-mix"],
  ["Snack – Orange and Walnut Salad", "orange-walnut-salad"],
  ["Snack – Roasted Chickpeas", "roasted-chickpeas"],
];

test("every current meal title maps to its food guide", () => {
  for (const [title, id] of CURRENT_MEALS)
    assert.deepEqual(ids(findGuides(foods, title)), [id], title);
});

test("each guide has its photos on disk, instructions and photo credits", () => {
  for (const [type, library, minimum] of [
    ["exercise", exercises, 2],
    ["food", foods, 1],
  ]) {
    for (const [id, item] of Object.entries(library.items)) {
      assert.equal(id, slug(id), `${type}/${id} id is URL-safe`);
      assert.ok(item.photos.length >= minimum, `${type}/${id} photos`);
      assert.ok(item.steps.length >= 2 && item.tips.length >= 1, id);
      for (const photo of item.photos) {
        for (const file of [photo.src, photo.thumb])
          assert.ok(existsSync(new URL(file.slice(1), PUBLIC)), file);
        assert.ok(photo.alt && photo.credit && photo.license, photo.src);
        if (photo.source) assert.match(photo.source, /^https:\/\//);
        else assert.equal(photo.license, "Original illustration", photo.src);
      }
    }
  }
});

test("no alias points at two different guides", () => {
  for (const library of [exercises, foods]) {
    const owners = new Map();
    for (const { id, pattern } of library.matchers) {
      assert.equal(owners.get(pattern.source) ?? id, id, pattern.source);
      owners.set(pattern.source, id);
    }
  }
});

test("the most specific exercise named in a step wins", () => {
  assert.deepEqual(
    ids(
      findGuides(
        exercises,
        "Perform 3 sets of 30-second side planks per side.",
      ),
    ),
    ["side-plank"],
  );
  assert.deepEqual(
    ids(findGuides(exercises, "Hold chest and shoulder stretch 30 seconds.")),
    ["chest-opener-stretch"],
  );
  assert.deepEqual(
    ids(findGuides(exercises, "Plank with Shoulder Taps: 3 sets of 20 taps")),
    ["plank-shoulder-tap"],
  );
  assert.deepEqual(
    ids(findGuides(exercises, "Optional light walk outside for 10-15 minutes")),
    ["outdoor-walk"],
  );
  assert.deepEqual(findGuides(exercises, "Rest 60 seconds between sets."), []);
});

test("guide links accept ids, typed names and the apostrophe form", () => {
  assert.equal(
    guideHref("exercise", "childs-pose"),
    "/exercise/?q=childs-pose",
  );
  assert.equal(resolveGuide(exercises, "child's-pose").id, "childs-pose");
  assert.equal(
    resolveGuide(exercises, "Dumbbell Bicep Curls").id,
    "dumbbell-bicep-curl",
  );
  assert.equal(resolveGuide(foods, "rajma").id, "rajma");
  assert.equal(resolveGuide(exercises, "underwater basket weaving"), null);
});

test("rows whose name matches no guide use the steps they came from", () => {
  const task = {
    title: "Upper Body Finisher",
    steps: ["Finisher: 3 sets of 12 goblet squats, then 3 sets of 10 push-ups"],
  };
  const [row] = workoutExercises(task);
  assert.equal(row.name, "Finisher");
  assert.deepEqual(ids(exerciseRowGuides(exercises, task, row)), [
    "goblet-squat",
    "push-up",
  ]);
});

test("quantity-first steps become rows that link to their guides", () => {
  const task = {
    title: "Strength Training: Upper Body Dumbbell Circuit",
    steps: [
      "Perform 3 sets of 10-12 reps dumbbell bicep curls.",
      "Perform 3 sets of 15 bird dogs per side.",
      "Include 5 minutes foam rolling if available.",
    ],
  };
  const rows = workoutExercises(task);
  assert.deepEqual(
    rows.map((row) => ids(exerciseRowGuides(exercises, task, row))),
    [["dumbbell-bicep-curl"], ["bird-dog"], ["foam-rolling"]],
  );
});

test("task guides cover every exercise in the full routine", () => {
  const task = {
    role: "workout",
    title: "Core Stability and Balance Training",
    steps: [
      "Plank with Shoulder Taps: 3 sets of 20 taps",
      "Bridge March: 3 sets of 12 reps",
    ],
  };
  assert.deepEqual(ids(taskGuides(exercises, task)), [
    "plank-shoulder-tap",
    "bridge-march",
  ]);
  assert.deepEqual(
    ids(
      taskGuides(foods, {
        role: "meal",
        title: "Lunch – Vegetable Biryani with Raita",
      }),
    ),
    ["vegetable-biryani"],
  );
});

test("dishes and exercises likely in future plans resolve to the specific guide", () => {
  const meal = (title) => findGuides(foods, title)[0]?.id;
  assert.equal(meal("Lunch – Dal Tadka with Brown Rice"), "dal-tadka");
  assert.equal(
    meal("Breakfast – Moong Dal Chilla with Mint Chutney"),
    "chilla",
  );
  assert.equal(meal("Dinner – Palak Paneer with Roti"), "palak-paneer");
  assert.equal(meal("Snack – Sprouts Chaat"), "sprouts-salad");
  assert.equal(
    meal("Dinner – Baked Salmon with Roasted Vegetables"),
    "baked-salmon",
  );
  const exercise = (text) => ids(findGuides(exercises, text));
  assert.deepEqual(exercise("Push-ups: 3 sets of 10 reps"), ["push-up"]);
  assert.deepEqual(exercise("Walking lunges: 3 sets of 12 reps"), [
    "walking-lunge",
  ]);
  assert.deepEqual(exercise("Single-arm dumbbell row"), [
    "one-arm-dumbbell-row",
  ]);
  assert.deepEqual(exercise("Incline bench press"), ["incline-dumbbell-press"]);
  assert.deepEqual(exercise("Reverse crunches"), ["reverse-crunch"]);
  assert.deepEqual(exercise("Surya Namaskar: 5 rounds"), ["sun-salutation"]);
  assert.deepEqual(exercise("High knees: 3 x 30 seconds"), ["high-knees"]);
  assert.deepEqual(exercise("Wall sit: hold 45 seconds"), ["wall-sit"]);
  assert.deepEqual(exercise("Clamshells: 2 sets of 15 per side"), [
    "clamshell",
  ]);
  assert.deepEqual(exercise("Lateral lunges: 3 sets of 10"), ["side-lunge"]);
  assert.deepEqual(exercise("Half pigeon: hold 1 minute per side"), [
    "pigeon-pose",
  ]);
  assert.equal(meal("Snack – Date and Almond Energy Balls"), "energy-balls");
  assert.equal(meal("Lunch – Veggie Burrito Bowl"), "burrito-bowl");
});

test("workout focus comes from the title, then from the exercises' body areas", () => {
  const focus = (title, steps = []) =>
    workoutFocus(exercises, { title, steps });
  assert.equal(focus("Lower Body Strength with Cable Machine"), "Legs");
  assert.equal(focus("Dumbbell Circuit for Arms and Core"), "Arms");
  assert.equal(focus("Full Body Stretching"), "Stretching");
  assert.equal(focus("Treadmill Interval Training"), "Cardio");
  assert.equal(focus("Rest and Recovery Day"), "Stretching");
  assert.equal(
    focus("Session A", [
      "Goblet squats: 3 sets of 12 reps",
      "Lunges: 3 sets of 10 reps",
    ]),
    "Legs",
  );
  assert.equal(
    focus("Session B", [
      "Push-ups: 3 x 10",
      "Cable rows: 3 sets of 12 reps",
      "Hammer curls: 3 sets of 10 reps",
    ]),
    "Upper body",
  );
  assert.equal(
    focus("Session C", [
      "Goblet squats: 3 x 12",
      "Cable rows: 3 x 12",
      "Push-ups: 3 x 10",
    ]),
    "Full body",
  );
  assert.equal(focus("Session D", ["Follow the routine"]), "Workout");
});

test("every exercise guide names the body area it works", () => {
  const areas = new Set([
    "Legs",
    "Arms",
    "Shoulders",
    "Chest",
    "Back",
    "Core",
    "Cardio",
    "Full body",
    "Stretching",
  ]);
  for (const [id, item] of Object.entries(exercises.items))
    assert.ok(areas.has(item.area), id);
});

test("every exercise guide has one short how-to video", () => {
  const seen = new Set();
  for (const [id, item] of Object.entries(exercises.items)) {
    assert.ok(item.video, `${id} has a video`);
    assert.match(item.video.id, /^[\w-]{11}$/, id);
    assert.ok(item.video.seconds > 0 && item.video.seconds <= 300, id);
    assert.ok(item.video.title && item.video.channel, id);
    assert.ok(!seen.has(item.video.id), `${id} reuses a video`);
    seen.add(item.video.id);
  }
});
