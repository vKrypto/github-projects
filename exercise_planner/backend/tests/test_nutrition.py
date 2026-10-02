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


def test_off_target_protein_is_reported_with_the_day_and_numbers():
    plan = meal_plan()
    for task in plan.days[0].tasks:
        task.nutrition.protein_g, task.nutrition.carbs_g = 10, 95  # same calories, 30 g protein a day
    planning.validate_role('meal', plan, PROFILE)  # estimates alone never fail validation
    feedback = planning.nutrition_feedback(plan)
    assert 'Day 1 meals provide 30 g protein' in feedback
    assert 'allowed ±22 g' in feedback


def test_meal_macros_keep_protein_and_fill_calories_with_carbs_and_fat():
    plan = meal_plan()
    meal = plan.days[0].tasks[0]
    meal.nutrition.protein_g, meal.nutrition.carbs_g, meal.nutrition.fat_g = 20, 50, 10  # 370 kcal for a 600 kcal meal
    untouched = plan.days[0].tasks[1].nutrition.model_dump()
    planning.normalize_meal_macros(plan)
    n = meal.nutrition
    assert n.protein_g == 20
    assert abs(4*n.protein_g + 4*n.carbs_g + 9*n.fat_g - 600) <= 10
    assert (n.carbs_g, n.fat_g) == (90, 18)
    assert plan.days[0].tasks[1].nutrition.model_dump() == untouched


def test_meal_protein_comes_from_itemised_ingredient_estimates():
    plan = meal_plan()
    meal = plan.days[0].tasks[0]
    meal.ingredients = ['150 g firm tofu (~180 kcal, 20 g protein)', '1/2 cup brown rice, dry (~170 kcal, 4 g protein)',
                        '1 tsp sesame oil (~40 kcal)', '1 cup broccoli (~55 kcal, 4.5 g protein)']
    meal.nutrition.protein_g = 53
    planning.normalize_meal_macros(plan)
    assert meal.nutrition.protein_g == 28  # 20 + 4 + 4.5, rounded


def test_nutrition_feedback_gets_limited_revisions_then_the_plan_publishes():
    class Stubborn(FakeProvider):
        def generate(self, role, context, revision=''):
            self.generated.append((role, revision))
            if role != 'meal': return super().generate(role, context, revision)
            plan = meal_plan()
            for task in plan.days[0].tasks:
                task.nutrition.protein_g, task.nutrition.carbs_g = 10, 95
            return plan
    provider = Stubborn()
    plan = planning.generate(PROFILE, [], date(2026, 10, 1), provider=provider, days_count=2)
    meal_revisions = [r for role, r in provider.generated if role == 'meal' and r]
    assert len(meal_revisions) == planning.NUTRITION_REVISIONS
    assert 'Day 1 meals provide 30 g protein' in meal_revisions[0]
    assert plan['revisions']['meal'] == planning.NUTRITION_REVISIONS


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


def test_protein_feedback_lists_every_off_target_day_at_once():
    plan = meal_plan()
    for day in plan.days[:3]:
        for task in day.tasks:
            task.nutrition.protein_g, task.nutrition.carbs_g = 15, 90
    problems = planning.nutrition_problems(plan)
    assert [p.split(' meals')[0] for p in problems] == ['Day 1', 'Day 2', 'Day 3']
    assert 'allowed ±22 g' in problems[0]
