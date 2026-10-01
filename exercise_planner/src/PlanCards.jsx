import React, { useState } from "react";
import {
  Check,
  ArrowUpRight,
  Dumbbell,
  Utensils,
  Sparkles,
} from "lucide-react";
import {
  formatDuration,
  workoutExercises,
  exerciseQuantity,
  nutritionTotals,
  MACRO_LABELS,
} from "./quantities";
import { exerciseRowGuides, findGuides, useLibrary } from "./library";
import { GuideChips, GuideLink, GuideThumb, PhotoFocus } from "./Guide";
import MinimalPlan from "./MinimalPlan";

const GROUPS = [
  { role: "workout", title: "Workouts", Icon: Dumbbell },
  { role: "meal", title: "Meals", Icon: Utensils },
  { role: "care", title: "Care", Icon: Sparkles },
];

export default function PlanCards({
  tasks,
  date,
  today,
  statuses,
  busy,
  mark,
  onDetails,
  view = "cards",
  targets = null,
}) {
  const statusOf = (task) => statuses[`${date}/${task.id}`] || "pending";
  const exerciseLibrary = useLibrary("exercise").library;
  const foodLibrary = useLibrary("food").library;
  const [focus, setFocus] = useState(null);
  const openExercise = (guide) => setFocus({ type: "exercise", guide });
  if (view === "minimal" && tasks.some((t) => t.role !== "care"))
    return (
      <MinimalPlan
        tasks={tasks}
        date={date}
        statuses={statuses}
        targets={targets}
      />
    );
  const groups = GROUPS.map((group) => ({
    ...group,
    tasks: tasks.filter((t) => t.role === group.role),
  })).filter((g) => g.tasks.length);

  return (
    <div className="quantity-plan">
      <div className="day-quantity-summary">
        {groups.map(({ role, tasks: groupTasks, Icon }) => {
          const minutes = groupTasks.reduce((n, t) => n + t.minutes, 0);
          const done = groupTasks.filter((t) => statusOf(t) === "completed");
          const doneMinutes = done.reduce((n, t) => n + t.minutes, 0);
          const calories = groupTasks.reduce((n, t) => n + t.calories, 0);
          const totals = role === "meal" ? nutritionTotals(groupTasks) : null;
          return (
            <div className={`day-total-card ${role}`} key={role}>
              <span>
                <Icon size={15} />
                {role === "workout"
                  ? `Total workout ${today ? "today" : "for this day"}`
                  : role === "meal"
                    ? "Food planned"
                    : "Care planned"}
              </span>
              <strong>
                {role === "meal"
                  ? calories.toLocaleString()
                  : formatDuration(minutes)}
                {role === "meal" && <small> kcal</small>}
              </strong>
              <p>
                {role === "workout"
                  ? `${formatDuration(doneMinutes)} done · ${done.length}/${groupTasks.length} sessions`
                  : `${done.length}/${groupTasks.length} ${role === "meal" ? "meals" : "routines"} complete`}
              </p>
              {totals && (
                <p className="macro-summary">
                  {MACRO_LABELS.slice(0, 3)
                    .map(
                      ([key, label]) =>
                        `${totals[key]}${targets?.[key] ? `/${targets[key]}` : ""} g ${label}`,
                    )
                    .join(" · ")}
                </p>
              )}
              {role === "meal" && (
                <small>
                  Estimated calories
                  {totals && targets ? " · planned / daily target" : ""}
                </small>
              )}
              {role === "workout" && calories > 0 && (
                <small>~{calories.toLocaleString()} kcal estimated burn</small>
              )}
            </div>
          );
        })}
      </div>
      {groups.map(({ role, title, tasks: groupTasks, Icon }) => (
        <section className="activity-group" aria-label={title} key={role}>
          <div className="activity-group-heading">
            <h3>
              <Icon size={17} />
              {title}
            </h3>
            <span>
              {groupTasks.length}{" "}
              {role === "workout"
                ? "sessions"
                : role === "meal"
                  ? "meals"
                  : "routines"}
            </span>
          </div>
          <div className="activity-card-grid">
            {groupTasks.map((task) => {
              const status = statusOf(task);
              const exercises =
                role === "workout" ? workoutExercises(task) : [];
              const food =
                role === "meal" ? findGuides(foodLibrary, task.title)[0] : null;
              return (
                <article
                  className={`task activity-card ${role}-card ${status}`}
                  key={task.id}
                >
                  <div className="activity-card-top">
                    <div className="task-meta">
                      <span>{task.category}</span>
                    </div>
                    <span className={`activity-status ${status}`}>
                      {status === "completed"
                        ? "Completed"
                        : status === "skipped"
                          ? "Skipped"
                          : "To do"}
                    </span>
                  </div>
                  <div className="activity-title-row">
                    {food && (
                      <GuideThumb
                        guide={food}
                        size="large"
                        onOpen={() => setFocus({ type: "food", guide: food })}
                      />
                    )}
                    <div>
                      <button
                        className="task-info task-details-button"
                        onClick={() => onDetails(task)}
                      >
                        <h3>
                          {task.title}
                          <ArrowUpRight size={14} />
                        </h3>
                      </button>
                      {food && (
                        <GuideLink
                          type="food"
                          id={food.id}
                          className="guide-inline-link"
                        >
                          How to prepare &amp; eat it
                        </GuideLink>
                      )}
                    </div>
                  </div>
                  <div className="activity-amount">
                    <strong>
                      {role === "meal"
                        ? task.calories.toLocaleString()
                        : formatDuration(task.minutes)}
                      {role === "meal" && <small> kcal</small>}
                    </strong>
                    <span>
                      {role === "meal"
                        ? `${formatDuration(task.minutes)} prep`
                        : role === "workout"
                          ? `total session${task.calories ? ` · ~${task.calories} kcal` : ""}`
                          : "routine"}
                    </span>
                  </div>
                  {role === "meal" && task.nutrition && (
                    <div className="macro-row" aria-label="Nutrition">
                      {MACRO_LABELS.map(([key, label]) => (
                        <span key={key}>
                          <b>{task.nutrition[key]} g</b> {label}
                        </span>
                      ))}
                    </div>
                  )}
                  {role === "workout" && exercises.length > 0 ? (
                    <div className="exercise-quantities">
                      <span className="quantity-label">EXERCISES</span>
                      {exercises.map((exercise, index) => {
                        const guides = exerciseRowGuides(
                          exerciseLibrary,
                          task,
                          exercise,
                        );
                        return (
                          <div
                            className={`exercise-quantity${
                              guides.length === 1
                                ? " with-thumb"
                                : guides.length > 1
                                  ? " with-chips"
                                  : ""
                            }`}
                            key={index}
                          >
                            <div className="exercise-name">
                              {guides.length === 1 && (
                                <GuideThumb
                                  guide={guides[0]}
                                  onOpen={() => openExercise(guides[0])}
                                />
                              )}
                              <span>
                                {guides.length === 1 ? (
                                  <GuideLink type="exercise" id={guides[0].id}>
                                    {exercise.name}
                                  </GuideLink>
                                ) : (
                                  exercise.name
                                )}
                              </span>
                            </div>
                            <div>
                              <strong>{exerciseQuantity(exercise)}</strong>
                              {exercise.minutes &&
                                (exercise.reps || exercise.hold_seconds) && (
                                  <small>
                                    {formatDuration(exercise.minutes)}
                                  </small>
                                )}
                              {exercise.calories > 0 && (
                                <small>~{exercise.calories} kcal</small>
                              )}
                              {exercise.rest_seconds != null &&
                                exercise.rest_seconds > 0 && (
                                  <small>
                                    {exercise.rest_seconds} sec rest between
                                    sets
                                  </small>
                                )}
                            </div>
                            {guides.length > 1 && (
                              <GuideChips
                                type="exercise"
                                guides={guides}
                                onOpen={openExercise}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : role === "meal" && task.ingredients?.length > 0 ? (
                    <div className="meal-portions">
                      <span className="quantity-label">PORTIONS</span>
                      <ul>
                        {task.ingredients.slice(0, 4).map((portion, index) => (
                          <li key={index}>{portion}</li>
                        ))}
                      </ul>
                      {task.ingredients.length > 4 && (
                        <button
                          className="remaining-details"
                          onClick={() => onDetails(task)}
                        >
                          +{task.ingredients.length - 4} more ingredients{" "}
                          <ArrowUpRight size={12} />
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="routine-preview">
                      <span className="quantity-label">
                        {role === "workout"
                          ? "ROUTINE"
                          : role === "meal"
                            ? "PREPARATION"
                            : "STEPS"}
                      </span>
                      <ul>
                        {task.steps?.slice(0, 3).map((step, index) => {
                          const guides =
                            role === "workout"
                              ? findGuides(exerciseLibrary, step)
                              : [];
                          return (
                            <li key={index}>
                              {step}
                              {guides.length > 0 && (
                                <GuideChips
                                  type="exercise"
                                  guides={guides}
                                  onOpen={openExercise}
                                />
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      {task.steps?.length > 3 && (
                        <button
                          className="remaining-details"
                          onClick={() => onDetails(task)}
                        >
                          +{task.steps.length - 3} more steps{" "}
                          <ArrowUpRight size={12} />
                        </button>
                      )}
                    </div>
                  )}
                  <div className="activity-card-actions">
                    <button
                      disabled={busy}
                      className={`complete-task ${status === "completed" ? "checked" : ""}`}
                      aria-label={`Mark ${task.title} ${status === "completed" ? "pending" : "completed"}`}
                      onClick={() =>
                        mark(
                          task,
                          status === "completed" ? "pending" : "completed",
                        )
                      }
                    >
                      <Check size={15} />
                      {status === "completed" ? "Completed" : "Complete"}
                    </button>
                    <button
                      disabled={busy}
                      className="skip"
                      onClick={() =>
                        mark(task, status === "skipped" ? "pending" : "skipped")
                      }
                    >
                      {status === "skipped" ? "Undo skip" : "Skip"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
      {focus && (
        <PhotoFocus
          type={focus.type}
          guide={focus.guide}
          onClose={() => setFocus(null)}
        />
      )}
    </div>
  );
}
