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
    const side = exercise.reps.match(
      /^(.*?)\s+((?:per|each) (?:side|leg|arm))$/i,
    );
    return side
      ? `${sets}${side[1]} reps ${side[2]}`
      : `${sets}${exercise.reps} reps`;
  }
  if (exercise.hold_seconds)
    return exercise.hold_seconds >= 60 && exercise.hold_seconds % 60 === 0
      ? `${sets}${exercise.hold_seconds / 60} min hold`
      : `${sets}${exercise.hold_seconds} sec hold`;
  if (exercise.minutes) return `${sets}${formatDuration(exercise.minutes)}`;
  return "";
}

const LEADING_VERB =
  /^\s*(?:perform|do|complete|include|practice|try|add|hold)\s+/i;

// Steps that start with their quantity ("Perform 3 sets of 15 bird dogs per
// side.") name the exercise after it; drop the qualifiers that follow.
function trailingName(text) {
  return text
    .replace(/^\s*(?:reps?\s+)?(?:each\s+)?(?:of\s+)?/i, "")
    .replace(/^(?:slow|controlled|easy)\s+/i, "")
    .split(
      /[(.;]|,\s*(?:\d|rest\b)| (?:per|each|focusing|for|at|using|until|if)\b| slow(?:ly)?\b| lying (?:down|on)\b| with (?:a )?light\b/i,
    )[0]
    .trim();
}

const capitalize = (name) => name.charAt(0).toUpperCase() + name.slice(1);

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
      const seconds = text.match(/(\d+)\s*-?\s*(?:seconds?|secs?)\b/i);
      const minutes = text.match(/(\d+)\s*-?\s*(?:minutes?|mins?)\b/i);
      // "3 sets of 15 bird dogs": a count without the word "reps".
      const setsOf =
        !reps &&
        text.match(
          /(\d+)\s*sets?\s+of\s+(\d+(?:\s*[-–]\s*\d+)?)\b(?!\s*-?\s*(?:reps?|repetitions?|seconds?|secs?|minutes?|mins?)\b)/i,
        );
      if (!reps && !compact && !seconds && !minutes && !setsOf) continue;
      const timedCompact =
        compact && /^(seconds?|secs?|minutes?|mins?)$/i.test(compact[3] || "");
      const secondsCompact =
        compact && /^(seconds?|secs?)$/i.test(compact[3] || "");
      const quantities = [sets, reps, compact, seconds, minutes, setsOf].filter(
        Boolean,
      );
      const firstQuantity = Math.min(...quantities.map((m) => m.index));
      const lastQuantity = Math.max(
        ...quantities.map((m) => m.index + m[0].length),
      );
      let name = text.includes(":")
        ? text.slice(0, text.indexOf(":"))
        : text.slice(0, firstQuantity);
      name = name
        .replace(LEADING_VERB, "")
        .replace(/\s+(?:for\s+)?\d+\s*[-–]\s*$/, "")
        .replace(/\s+if available$/i, "")
        .replace(/\s+(?:for|hold for|hold|do|perform|complete)\s*$/i, "")
        .trim()
        .replace(/[-–,]\s*$/, "")
        .trim();
      if (!text.includes(":")) {
        const after = trailingName(text.slice(lastQuantity));
        if (/^(?:include|perform|do|complete)?$/i.test(name)) name = after;
        else if (/\s(?:with|by|of)$/i.test(name) && after)
          name = `${name} ${after}`;
      }
      if (!name || /^(hold|for|walk continuously for)$/i.test(name))
        name = task.title;
      const side = text.match(/\b(?:per|each)\s+(side|leg|arm)\b/i);
      let count = reps
        ? `${reps[1]}${reps[2] ? ` ${reps[2]}` : ""}`
        : compact && !timedCompact
          ? compact[2]
          : setsOf
            ? setsOf[2]
            : null;
      if (count && side && !/(?:per|each) (?:side|leg|arm)$/i.test(count))
        count = `${count} per ${side[1].toLowerCase()}`;
      const entry = {
        name: capitalize(name),
        sets: sets ? Number(sets[1]) : compact ? Number(compact[1]) : null,
        reps: count,
        hold_seconds:
          !reps && !setsOf && (!compact || timedCompact)
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
