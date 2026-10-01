import json, threading, time
from datetime import date
import pytest
from backend import server, planning
from backend.plan_updates import adjustment_window
from backend.tests.test_phase1 import PROFILE, FakeProvider, client, signup, seed_plan


@pytest.fixture
def ready(client, monkeypatch):
    monkeypatch.setattr(server, 'today', lambda tz='Asia/Kolkata': date(2026,10,1))
    account = signup(client)
    client.put('/api/profile',json=PROFILE)
    initial = seed_plan(account)
    captured = []
    class RecordingProvider(FakeProvider):
        def generate(self, role, context, revision=''):
            captured.append(context)
            result = super().generate(role, context, revision)
            if context.get('saved_preferences'):
                for day in result.days:
                    for task in day.tasks:
                        task.title = 'Updated '+task.title
            return result
    monkeypatch.setenv('LLM_PROVIDER','test')
    monkeypatch.setitem(planning.PROVIDERS,'test',RecordingProvider)
    return client, account, initial, captured


def finished(client, response):
    assert response.status_code == 202, response.text
    for _ in range(100):
        job=client.get('/api/jobs/'+response.json()['id']).json()
        if job['status'] in ('completed','failed'): break
        time.sleep(.02)
    assert job['status']=='completed',job
    return client.get('/api/plan').json()['plan']


def test_refine_changes_only_selected_days_and_preserves_completed_and_skipped(ready):
    client, account, initial, captured = ready
    day=initial['days'][0]
    for task,status in [(day['tasks'][0],'completed'),(day['tasks'][1],'skipped')]:
        assert client.put('/api/tasks/status',json={'date':day['date'],'task_id':task['id'],'status':status}).status_code==200
    updated=finished(client,client.post('/api/plans/refine',json={'days':3,'preferences':'  Shorter workouts and quick vegan lunches.  '}))
    assert len(updated['days'])==28
    assert updated['days'][3:]==initial['days'][3:]
    kept={t['id']:t for t in updated['days'][0]['tasks']}
    assert kept[day['tasks'][0]['id']]==day['tasks'][0]
    assert kept[day['tasks'][1]['id']]==day['tasks'][1]
    new=[t for t in updated['days'][0]['tasks'] if t['id'] not in kept or t['id'] not in [day['tasks'][0]['id'],day['tasks'][1]['id']]]
    assert new and all(t['title'].startswith('Updated ') for t in new)
    progress=client.get('/api/progress').json()
    assert {s['status'] for s in progress['statuses']}=={'completed','skipped'}
    assert progress['history'][0]['completed']==1
    assert updated['last_change']['action']=='refine' and updated['last_change']['days']==3
    prefs=client.get('/api/preferences').json()
    assert prefs[0]['text']=='Shorter workouts and quick vegan lunches.'
    assert all(c['saved_preferences'][0]['text']==prefs[0]['text'] and c['length_days']==3 and c['action']=='refine' for c in captured)
    assert any('refined for 3 days' in n['message'] for n in client.get('/api/me').json()['notifications'])
    # Future generation gets the stored preference without asking for it again.
    captured.clear()
    finished(client,client.post('/api/plans/generate'))
    assert all(c['saved_preferences'][0]['text']==prefs[0]['text'] for c in captured)


@pytest.mark.parametrize('count',[1,7,28])
def test_extend_appends_exact_days_and_care_does_not_restart_delay(ready,count):
    client,account,initial,captured=ready
    task=initial['days'][0]['tasks'][0]
    client.put('/api/tasks/status',json={'date':initial['start_date'],'task_id':task['id'],'status':'completed'})
    updated=finished(client,client.post('/api/plans/extend',json={'days':count,'preferences':'Continue with more variety.'}))
    assert updated['days'][:28]==initial['days']
    assert len(updated['days'])==28+count
    assert updated['days'][28]['date']=='2026-10-29'
    assert updated['days'][-1]['week']==(27+count)//7+1
    assert all(any(t['role']=='care' for t in d['tasks']) for d in updated['days'][28:])
    assert client.get('/api/progress').json()['statuses'][0]['status']=='completed'
    assert all(c['journey_day_offset']==28 and c['action']=='extend' and c['length_days']==count for c in captured)
    assert any('extended for' in n['message'] for n in client.get('/api/me').json()['notifications'])


@pytest.mark.parametrize('path',['refine','extend'])
@pytest.mark.parametrize('payload',[
    {'days':0,'preferences':'Change this'}, {'days':29,'preferences':'Change this'},
    {'days':7,'preferences':'   '}, {'days':7,'preferences':''}, {'days':1.5,'preferences':'Change this'}])
def test_invalid_requests_are_rejected_without_saving_preferences(ready,path,payload):
    client,*_=ready
    assert client.post('/api/plans/'+path,json=payload).status_code==422
    assert client.get('/api/preferences').json()==[]


def test_refine_rejects_past_end_and_requests_require_existing_plan(client,monkeypatch):
    monkeypatch.setattr(server,'today',lambda tz='Asia/Kolkata':date(2026,10,27))
    account=signup(client);client.put('/api/profile',json=PROFILE)
    for path in ('refine','extend'):
        assert client.post('/api/plans/'+path,json={'days':7,'preferences':'Change this'}).status_code==422
    seed_plan(account)
    assert client.post('/api/plans/refine',json={'days':3,'preferences':'Change this'}).status_code==422
    assert client.get('/api/preferences').json()==[]


def test_failed_adjustment_preserves_plan_and_retry_reuses_preference(ready,monkeypatch):
    client,account,initial,captured=ready
    class Fails(FakeProvider):
        def generate(self,*a,**kw): raise planning.PlanningError('Provider unavailable')
    monkeypatch.setitem(planning.PROVIDERS,'test',Fails)
    response=client.post('/api/plans/extend',json={'days':2,'preferences':'More quick meals'})
    for _ in range(100):
        job=client.get('/api/jobs/'+response.json()['id']).json()
        if job['status']=='failed':break
        time.sleep(.02)
    assert job['status']=='failed'
    assert client.get('/api/plan').json()['plan']==initial
    assert len(client.get('/api/preferences').json())==1
    monkeypatch.setitem(planning.PROVIDERS,'test',FakeProvider)
    updated=finished(client,client.post('/api/jobs/'+job['id']+'/retry'))
    assert len(updated['days'])==30
    assert len(client.get('/api/preferences').json())==1
    assert client.post('/api/jobs/'+client.get('/api/me').json()['job']['id']+'/retry').status_code==409


def test_preferences_and_retry_are_tenant_scoped(ready):
    client,account,initial,captured=ready
    r=client.post('/api/plans/refine',json={'days':1,'preferences':'Prefer mornings'})
    finished(client,r)
    client.post('/api/auth/logout');signup(client,'other@example.com')
    assert client.get('/api/preferences').json()==[]
    assert client.post('/api/jobs/'+r.json()['id']+'/retry').status_code==404
    assert client.get('/api/me').json()['preferences']==[]


def test_duplicate_job_is_rejected_without_duplicate_note(ready,monkeypatch):
    client,account,initial,captured=ready
    entered=threading.Event();release=threading.Event()
    class Blocking(FakeProvider):
        def generate(self,*args,**kwargs):
            entered.set();release.wait(5)
            return super().generate(*args,**kwargs)
    monkeypatch.setitem(planning.PROVIDERS,'test',Blocking)
    try:
        r=client.post('/api/plans/extend',json={'days':1,'preferences':'Prefer mornings'})
        assert entered.wait(2)
        assert client.post('/api/plans/refine',json={'days':1,'preferences':'Duplicate note'}).status_code==409
        assert len(client.get('/api/preferences').json())==1
    finally: release.set()
    finished(client,r)


def test_extension_of_expired_plan_starts_today(ready,monkeypatch):
    client,account,initial,captured=ready
    monkeypatch.setattr(server,'today',lambda tz='Asia/Kolkata':date(2026,11,5))
    updated=finished(client,client.post('/api/plans/extend',json={'days':2,'preferences':'Restart gently'}))
    assert updated['days'][28]['date']=='2026-11-05'
    assert updated['end_date']=='2026-11-06'
