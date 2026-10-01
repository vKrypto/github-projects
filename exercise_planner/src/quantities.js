export function formatDuration(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  if (!hours) return `${remainder} min`;
  return `${hours} hr${remainder ? ` ${remainder} min` : ""}`;
}

export function exerciseQuantity(exercise) {
  const sets = exercise.sets ? `${exercise.sets} sets × ` : "";
  if (exercise.reps) {
    const side = exercise.reps.match(/^(.*?)\s+((?:per|each) side)$/i);
    return side
      ? `${sets}${side[1]} reps ${side[2]}`
      : `${sets}${exercise.reps} reps`;
  }
  if (exercise.hold_seconds) return `${sets}${exercise.hold_seconds} sec hold`;
  if (exercise.minutes) return `${sets}${formatDuration(exercise.minutes)}`;
  return "";
}

// Older saved plans have exercise prescriptions in their routine steps.
// Extract explicit quantities only; never allocate session time across exercises.
export function workoutExercises(task) {
  if (task.exercises?.length) return task.exercises;
  const exercises = [];
  for (const step of task.steps || []) {
    for (const line of step.split(/\n|;\s*/)) {
      if (/^\s*(rest|repeat|recover|take a break)\b/i.test(line)) continue;
      const text = line.split(/\brest(?:ing)?\b/i)[0];
      const sets = text.match(/(\d+)\s*sets?\b/i);
      const reps = text.match(
        /(\d+(?:\s*[-–]\s*\d+)?)\s*(?:reps?|repetitions?)\b(?:\s+((?:per|each) side))?/i,
      );
      const compact = text.match(
        /(\d+)\s*[x×]\s*(\d+(?:\s*[-–]\s*\d+)?)(?:\s*(reps?|seconds?|secs?|minutes?|mins?))?\b/i,
      );
      const seconds = text.match(/(\d+)\s*(?:seconds?|secs?)\b/i);
      const minutes = text.match(/(\d+)\s*(?:minutes?|mins?)\b/i);
      if (!reps && !compact && !seconds && !minutes) continue;
      const timedCompact =
        compact && /^(seconds?|secs?|minutes?|mins?)$/i.test(compact[3] || "");
      const secondsCompact =
        compact && /^(seconds?|secs?)$/i.test(compact[3] || "");
      const firstQuantity = Math.min(
        ...[sets, reps, compact, seconds, minutes]
          .filter(Boolean)
          .map((m) => m.index),
      );
      let name = text.includes(":")
        ? text.slice(0, text.indexOf(":"))
        : text.slice(0, firstQuantity);
      name = name
        .replace(/^\s*(perform|do|complete)\s+/i, "")
        .replace(/\s+(?:for|hold for|hold|do|perform|complete)\s*$/i, "")
        .trim()
        .replace(/[-–,]\s*$/, "")
        .trim();
      if (!name || /^(hold|for|walk continuously for)$/i.test(name))
        name = task.title;
      const entry = {
        name,
        sets: sets ? Number(sets[1]) : compact ? Number(compact[1]) : null,
        reps: reps
          ? `${reps[1]}${reps[2] ? ` ${reps[2]}` : ""}`
          : compact && !timedCompact
            ? compact[2]
            : null,
        hold_seconds:
          !reps && (!compact || timedCompact)
            ? Number(seconds?.[1] || (secondsCompact ? compact[2] : 0)) || null
            : null,
        minutes: minutes ? Number(minutes[1]) : null,
        rest_seconds: null,
      };
      const key = `${entry.name.toLowerCase()}/${exerciseQuantity(entry)}`;
      if (
        !exercises.some(
          (e) => `${e.name.toLowerCase()}/${exerciseQuantity(e)}` === key,
        )
      )
        exercises.push(entry);
    }
  }
  return exercises;
}

const MACROS = ["protein_g", "carbs_g", "fat_g", "fiber_g"];

// Plans generated before meals carried nutrition have none; return null then
// rather than showing zero grams.
export function nutritionTotals(meals) {
  const known = meals.filter((meal) => meal.nutrition);
  if (!known.length) return null;
  return Object.fromEntries(
    MACROS.map((key) => [
      key,
      known.reduce((total, meal) => total + (meal.nutrition[key] || 0), 0),
    ]),
  );
}

export const MACRO_LABELS = [
  ["protein_g", "protein"],
  ["carbs_g", "carbs"],
  ["fat_g", "fat"],
  ["fiber_g", "fibre"],
];
