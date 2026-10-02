from datetime import date
import pytest
from openai.lib._pydantic import to_strict_json_schema
from backend import planning
from backend.models import MealPlan, WorkoutPlan
from backend.tests.test_phase1 import FakeProvider, PROFILE
from backend.tests.test_workout_quantities import quantified_workout

TARGETS = {'protein_g': 90, 'carbs_g': 225, 'fat_g': 60, 'fiber_g': 30}


def meal_plan():
    data = FakeProvider().generate('meal', {'profile': PROFILE}).model_dump()
    data['daily_nutrition_targets'] = TARGETS
    for day in data['days']:
        for task in day['tasks']:
            # 600 kcal = 4*30 + 4*75 + 9*20
            task['nutrition'] = {'protein_g': 30, 'carbs_g': 75, 'fat_g': 20, 'fiber_g': 10}
    return MealPlan.model_validate(data)


def test_meal_nutrition_and_exercise_burn_are_required_in_the_structured_output_schema():
    meal = to_strict_json_schema(MealPlan)
    assert 'nutrition' in meal['$defs']['MealTask']['required']
    assert set(meal['$defs']['MealNutrition']['required']) == {'protein_g', 'carbs_g', 'fat_g', 'fiber_g'}
    assert 'daily_nutrition_targets' in meal['required']
    exercise = to_strict_json_schema(WorkoutPlan)['$defs']['WorkoutExercise']
    assert 'calories' in exercise['required']
    assert exercise['properties']['calories']['type'] == 'integer'


def test_consistent_nutrition_passes_validation():
    planning.validate_role('meal', meal_plan(), PROFILE)
    planning.validate_role('workout', quantified_workout(), PROFILE)


@pytest.mark.parametrize('problem', ['macros', 'protein'])
def test_inconsistent_meal_nutrition_feeds_planning_validation(problem):
    plan = meal_plan()
    if problem == 'macros':
        plan.days[0].tasks[0].nutrition.fat_g = 60  # 960 kcal of macros for a 600 kcal meal
    else:
        for task in plan.days[0].tasks:
            task.nutrition.protein_g, task.nutrition.carbs_g = 10, 95  # same calories, 30 g protein a day
    with pytest.raises(planning.PlanningError) as error:
        planning.validate_role('meal', plan, PROFILE)
    # Feedback names the day and the numbers so a revision can correct it.
    assert 'Day 1' in str(error.value)
    assert ('960 kcal' if problem == 'macros' else '30 g protein') in str(error.value)


def test_exercise_burn_cannot_exceed_the_session_estimate():
    plan = quantified_workout()
    plan.days[0].tasks[0].exercises[0].calories = 400
    with pytest.raises(planning.PlanningError, match='calorie'):
        planning.validate_role('workout', plan, PROFILE)


def test_generated_plan_keeps_nutrition_targets_and_estimates():
    class Detailed(FakeProvider):
        def generate(self, role, context, revision=''):
            if role == 'meal': return meal_plan()
            if role == 'workout': return quantified_workout()
            return super().generate(role, context, revision)
    plan = planning.generate(PROFILE, [], date(2026, 10, 1), provider=Detailed(), days_count=2)
    assert plan['daily_nutrition_targets'] == TARGETS
    day = plan['days'][0]
    assert day['daily_nutrition_targets'] == TARGETS
    meal = next(t for t in day['tasks'] if t['role'] == 'meal')
    assert meal['nutrition'] == {'protein_g': 30, 'carbs_g': 75, 'fat_g': 20, 'fiber_g': 10}
    workout = next(t for t in day['tasks'] if t['role'] == 'workout')
    assert workout['exercises'][0]['calories'] == 80


def test_nutrition_feedback_lists_every_off_target_day_at_once():
    plan = meal_plan()
    for day in plan.days[:3]:
        for task in day.tasks:
            task.nutrition.protein_g, task.nutrition.carbs_g = 15, 90
    problems = planning.nutrition_problems(plan)
    assert [p.split(' meals')[0] for p in problems] == ['Day 1', 'Day 2', 'Day 3']
    assert 'allowed ±22 g' in problems[0]
