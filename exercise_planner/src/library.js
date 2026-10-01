import { useEffect, useState } from "react";
import { exerciseQuantity, workoutExercises } from "./quantities.js";

// Guides live entirely in the frontend: public/library/<type>.json maps plan
// text to an item with photos and instructions, served at /<type>/?q=<id>.
export const GUIDE_TYPES = ["exercise", "food"];

export function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const slug = (text) => normalize(text).replace(/ /g, "-");

// Meal titles lead with their slot, e.g. "Lunch – Rajma (Kidney Bean) Curry".
const MEAL_PREFIX = /^\s*(breakfast|lunch|dinner|snacks?)\s*[-–—:]\s*/i;

export function prepareLibrary(data) {
  const matchers = [];
  for (const [id, item] of Object.entries(data.items)) {
    for (const alias of item.aliases || []) {
      const words = normalize(alias);
      if (!words) continue;
      matchers.push({
        id,
        length: words.length,
        pattern: new RegExp(`(?:^| )${words}(?:s|es|ing)?(?= |$)`, "g"),
      });
    }
  }
  return { ...data, matchers };
}

const withId = (library, id) => ({ id, ...library.items[id] });

const uniqueGuides = (guides) =>
  guides.filter((g, i) => guides.findIndex((o) => o.id === g.id) === i);

// Every guide named in the text, in reading order. Where aliases overlap the
// most specific one wins, so "side planks" is a side plank rather than a plank.
export function findGuides(library, text) {
  if (!library || !text) return [];
  const haystack = normalize(String(text).replace(MEAL_PREFIX, ""));
  const hits = [];
  for (const { id, length, pattern } of library.matchers) {
    for (const found of haystack.matchAll(pattern)) {
      const start = found.index + (found[0].startsWith(" ") ? 1 : 0);
      hits.push({ id, length, start, end: found.index + found[0].length });
    }
  }
  hits.sort((a, b) => b.length - a.length || a.start - b.start);
  const kept = [];
  for (const hit of hits)
    if (!kept.some((k) => hit.start < k.end && k.start < hit.end))
      kept.push(hit);
  kept.sort((a, b) => a.start - b.start);
  return uniqueGuides(kept.map((hit) => withId(library, hit.id)));
}

// A ?q= value may be an item id ("childs-pose", "child's-pose") or free text.
export function resolveGuide(library, query) {
  if (!library || !query) return null;
  const id = slug(query);
  if (library.items[id]) return withId(library, id);
  return findGuides(library, String(query).replace(/[-_]+/g, " "))[0] || null;
}

const rowKey = (exercise) =>
  `${exercise.name.toLowerCase()}/${exerciseQuantity(exercise)}`;

// Older plans name some rows after a leading word or the session itself
// ("Include", "Interval Training…"), so fall back to the steps the row was
// parsed from to find the exercises it actually describes.
export function exerciseRowGuides(library, task, exercise) {
  const byName = findGuides(library, exercise.name);
  if (byName.length || task.exercises?.length) return byName;
  const key = rowKey(exercise);
  const sources = (task.steps || []).filter((step) =>
    workoutExercises({ title: task.title, steps: [step] }).some(
      (e) => rowKey(e) === key,
    ),
  );
  return uniqueGuides(sources.flatMap((step) => findGuides(library, step)));
}

export function taskGuides(library, task) {
  if (!library) return [];
  if (task.role === "meal") return findGuides(library, task.title).slice(0, 1);
  const texts = [
    ...(task.exercises || []).map((e) => e.name),
    ...(task.steps || []),
  ];
  return uniqueGuides(texts.flatMap((text) => findGuides(library, text)));
}

const requests = {};
export function loadLibrary(type) {
  requests[type] ??= fetch(`/library/${type}.json`)
    .then((response) => {
      if (!response.ok)
        throw new Error(`Guide library unavailable (${response.status}).`);
      return response.json();
    })
    .then(prepareLibrary)
    .catch((error) => {
      delete requests[type];
      throw error;
    });
  return requests[type];
}

export function useLibrary(type) {
  const [state, setState] = useState({ library: null, error: null });
  useEffect(() => {
    let live = true;
    loadLibrary(type).then(
      (library) => live && setState({ library, error: null }),
      (error) => live && setState({ library: null, error }),
    );
    return () => {
      live = false;
    };
  }, [type]);
  return state;
}

export const guideHref = (type, id) =>
  id ? `/${type}/?q=${encodeURIComponent(id)}` : `/${type}/`;

export function guideRoute(location = window.location) {
  const match = location.pathname.match(/^\/(exercise|food)\/?$/);
  if (!match) return null;
  return {
    type: match[1],
    query: new URLSearchParams(location.search).get("q") || "",
  };
}

export function navigate(href) {
  window.history.pushState({ forma: true }, "", href);
  window.dispatchEvent(
    new PopStateEvent("popstate", { state: { forma: true } }),
  );
}

// Plain clicks stay in the app so the plan keeps its state; modified clicks
// (new tab, new window) fall through to the browser.
export function followLink(event) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  navigate(event.currentTarget.getAttribute("href"));
}

const FOCUS_WORDS = [
  ["Full body", "full body|total body"],
  ["Upper body", "upper body"],
  ["Legs", "lower body|legs?|glutes?|quads?|hamstrings?"],
  ["Arms", "arms?|biceps?|triceps?"],
  ["Chest", "chest"],
  ["Back", "back"],
  ["Shoulders", "shoulders?"],
  ["Core", "core|abs|abdominals?"],
  [
    "Cardio",
    "cardio|treadmill|run|running|jog|jogging|walk|walking|cycling|hiit|elliptical|rowing|swim|swimming",
  ],
  [
    "Stretching",
    "stretch|stretches|stretching|yoga|mobility|recovery|relax|relaxation|flexibility|cool down|rest",
  ],
].map(([label, words]) => [label, new RegExp(`(?:^| )(?:${words})(?= |$)`)]);
const STRETCH_TITLE = /(?:^| )(?:stretch|stretches|stretching|yoga)(?= |$)/;
const UPPER = new Set(["Arms", "Chest", "Back", "Shoulders"]);

// The body area a session works, for the minimal plan view. Titles usually
// name it ("Lower Body Strength…"); otherwise the exercises' areas decide.
export function workoutFocus(library, task) {
  const title = normalize(task.title);
  // "Full Body Stretching" is a stretching session, whatever part it names.
  if (STRETCH_TITLE.test(title)) return "Stretching";
  let named = null;
  for (const [label, pattern] of FOCUS_WORDS) {
    const index = title.search(pattern);
    if (index >= 0 && (!named || index < named.index)) named = { label, index };
  }
  if (named) return named.label;
  const areas = taskGuides(library, task)
    .map((guide) => guide.area)
    .filter(Boolean);
  if (!areas.length) return "Workout";
  const counts = new Map();
  for (const area of areas) counts.set(area, (counts.get(area) || 0) + 1);
  const [top, topCount] = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (topCount * 2 >= areas.length) return top;
  const upper = [...counts.keys()].filter((area) => UPPER.has(area));
  if (upper.length && counts.has("Legs")) return "Full body";
  if (upper.length >= 2) return "Upper body";
  return top;
}
