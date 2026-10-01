import React from "react";
import { Check, Dumbbell, Utensils } from "lucide-react";
import { formatDuration, nutritionTotals } from "./quantities";
import { useLibrary, workoutFocus } from "./library";

// Two compact cards: time per body area worked, and the day's ingredients.
export default function MinimalPlan({ tasks, date, statuses, targets }) {
  const library = useLibrary("exercise").library;
  const done = (task) => statuses[`${date}/${task.id}`] === "completed";
  const workouts = tasks.filter((t) => t.role === "workout");
  const meals = tasks.filter((t) => t.role === "meal");

  const focus = [];
  for (const task of workouts) {
    const label = workoutFocus(library, task);
    let row = focus.find((f) => f.label === label);
    if (!row)
      focus.push((row = { label, minutes: 0, calories: 0, sessions: [] }));
    row.minutes += task.minutes;
    row.calories += task.calories;
    row.sessions.push(task);
  }
  const workoutMinutes = workouts.reduce((n, t) => n + t.minutes, 0);
  const workoutCalories = workouts.reduce((n, t) => n + t.calories, 0);
  const mealCalories = meals.reduce((n, t) => n + t.calories, 0);
  const totals = nutritionTotals(meals);

  return (
    <div className="minimal-plan">
      {workouts.length > 0 && (
        <section className="minimal-card workout" aria-label="Workout focus">
          <header>
            <h3>
              <Dumbbell size={16} /> Workout
            </h3>
            <span>
              {formatDuration(workoutMinutes)}
              {workoutCalories > 0 && (
                <small> · ~{workoutCalories.toLocaleString()} kcal</small>
              )}
            </span>
          </header>
          <ul className="minimal-focus">
            {focus.map(({ label, minutes, calories, sessions }) => {
              const complete = sessions.every(done);
              return (
                <li
                  key={label}
                  className={complete ? "completed" : ""}
                  title={sessions.map((s) => s.title).join(" · ")}
                >
                  <span>
                    {complete && <Check size={13} aria-label="Completed" />}
                    {label}
                  </span>
                  <span className="minimal-amount">
                    {calories > 0 && <small>~{calories} kcal</small>}
                    <strong>{formatDuration(minutes)}</strong>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {meals.length > 0 && (
        <section className="minimal-card meal" aria-label="Meal ingredients">
          <header>
            <h3>
              <Utensils size={16} /> Meals
            </h3>
            <span>
              {mealCalories.toLocaleString()} kcal
              {totals && (
                <small>
                  {" "}
                  · {totals.protein_g}
                  {targets?.protein_g ? `/${targets.protein_g}` : ""} g protein
                </small>
              )}
            </span>
          </header>
          {meals.map((meal) => (
            <div
              className={`minimal-meal ${done(meal) ? "completed" : ""}`}
              key={meal.id}
            >
              <span className="quantity-label">
                {meal.category.toUpperCase()}
                {done(meal) && <Check size={11} aria-label="Completed" />}
              </span>
              {meal.ingredients?.length ? (
                <ul>
                  {meal.ingredients.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>{meal.title}</p>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
