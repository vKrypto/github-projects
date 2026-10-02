"""Calendar windows and non-destructive merging for reviewed plan adjustments."""
from copy import deepcopy
from datetime import date, timedelta


def adjustment_window(plan, action, count, current_date):
    if not plan or not plan.get('days'):
        raise ValueError('Prepare an initial plan before refining or extending it.')
    if not 1 <= count <= 28:
        raise ValueError('Choose between 1 and 28 days.')
    if action == 'refine':
        start = max(current_date, date.fromisoformat(plan['start_date']))
        required = {(start + timedelta(days=i)).isoformat() for i in range(count)}
        available = {d['date'] for d in plan['days'] if d['date'] >= start.isoformat()}
        if not required <= available:
            raise ValueError('The requested days are not all in the current plan. Choose fewer days or use Extend Plan.')
    elif action == 'extend':
        start = max(current_date, date.fromisoformat(plan['end_date']) + timedelta(days=1))
    else:
        raise ValueError('Unknown plan action.')
    return start


def merge_adjustment(current, generated, action, statuses, job_id, preference, created):
    """Keep unrelated days and settled activities; new activities get distinct IDs."""
    merged = deepcopy(current)
    tracking = {(s['date'], s['task_id']): s['status'] for s in statuses}
    by_date = {d['date']: d for d in merged['days']}
    for proposed in generated['days']:
        day = deepcopy(proposed)
        for task in day['tasks']:
            task['id'] = f'{job_id}:{task["id"]}'
        if action == 'refine':
            old = by_date[day['date']]
            settled = [t for t in old['tasks'] if tracking.get((day['date'], t['id'])) in ('completed', 'skipped')]
            # A consumed/skipped meal stays the same even if the suggested time changed.
            meal_categories = {t['category'] for t in settled if t['role'] == 'meal'}
            slots = {(t['role'], t['category'], t['time']) for t in settled if t['role'] != 'meal'}
            replacements = [t for t in day['tasks'] if not (
                (t['role'] == 'meal' and t['category'] in meal_categories) or
                (t['role'], t['category'], t['time']) in slots)]
            day['tasks'] = sorted([*deepcopy(settled), *replacements], key=lambda t: t['time'])
        elif day['date'] in by_date:
            raise ValueError('Extension would overlap the current plan.')
        by_date[day['date']] = day
    merged['days'] = sorted(by_date.values(), key=lambda d: d['date'])
    for i, day in enumerate(merged['days']):
        day['week'] = i // 7 + 1
    merged['start_date'] = merged['days'][0]['date']
    merged['end_date'] = merged['days'][-1]['date']
    # Day-specific targets preserve earlier segments when the new plan has different goals.
    for day in merged['days']:
        day.setdefault('daily_calorie_target', current['daily_calorie_target'])
        day.setdefault('daily_burn_target', current.get('daily_burn_target', 0))
        day.setdefault('daily_nutrition_targets', current.get('daily_nutrition_targets'))
    for key in ('provider', 'model', 'summaries', 'assumptions', 'reviews', 'revisions', 'review_summary'):
        merged[key] = deepcopy(generated[key])
    # Plans created before nutrition targets existed adopt the first ones generated.
    if not merged.get('daily_nutrition_targets'):
        merged['daily_nutrition_targets'] = deepcopy(generated.get('daily_nutrition_targets'))
    change = {'action': action, 'days': len(generated['days']), 'start_date': generated['start_date'],
              'end_date': generated['end_date'], 'preferences': preference, 'created': created, 'job_id': job_id}
    merged['changes'] = [*current.get('changes', []), change]
    merged['last_change'] = change
    return merged
