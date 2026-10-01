from datetime import date
import pytest
from openai.lib._pydantic import to_strict_json_schema
from backend import planning
from backend.models import WorkoutPlan
from backend.tests.test_phase1 import FakeProvider, PROFILE


def quantified_workout():
    data=FakeProvider().generate('workout', {'profile':PROFILE}).model_dump()
    for day in data['days']:
        day['tasks'][0]['exercises']=[{'name':'Biceps','sets':3,'reps':'10','minutes':15,'hold_seconds':None,'rest_seconds':60,'calories':80}]
    return WorkoutPlan.model_validate(data)


def test_workout_exercise_schema_is_required_and_nullable_for_structured_outputs():
    schema=to_strict_json_schema(WorkoutPlan)
    exercise=schema['$defs']['WorkoutExercise']
    assert set(exercise['required'])==set(exercise['properties'])
    assert exercise['additionalProperties'] is False
    assert 'exercises' in schema['$defs']['WorkoutTask']['required']
    assert {'type':'null'} in exercise['properties']['minutes']['anyOf']


def test_generated_plan_persists_exercise_quantities_without_adding_minutes_to_session():
    class Quantified(FakeProvider):
        def generate(self, role, context, revision=''):
            return quantified_workout() if role=='workout' else super().generate(role,context,revision)
    plan=planning.generate(PROFILE,[],date(2026,10,1),provider=Quantified(),days_count=3)
    workouts=[next(t for t in day['tasks'] if t['role']=='workout') for day in plan['days']]
    assert all(t['minutes']==20 and t['exercises'][0]['minutes']==15 for t in workouts)
    assert all(t['exercises'][0]['sets']==3 and t['exercises'][0]['reps']=='10' for t in workouts)


@pytest.mark.parametrize('problem',['missing','empty_reps','missing_sets','unquantified','too_long'])
def test_invalid_workout_quantities_feed_planning_validation(problem):
    plan=quantified_workout()
    task=plan.days[0].tasks[0]
    if problem=='missing': task.exercises=[]
    elif problem=='empty_reps': task.exercises[0].reps=' '
    elif problem=='missing_sets': task.exercises[0].sets=None
    elif problem=='unquantified':
        task.exercises[0].reps=None;task.exercises[0].minutes=None
    else: task.exercises[0].minutes=21
    with pytest.raises(planning.PlanningError): planning.validate_role('workout',plan,PROFILE)
