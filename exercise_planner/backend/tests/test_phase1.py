import io, json, time
from datetime import date
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from backend import server, planning
from backend.models import RolePlan, PlanReview

PROFILE={'name':'Alex','email':'alex@example.com','focus':['Physique','Skin care','Hair care'],'body_areas':['Arms'],'custom_area':'','diet':['Vegan'],'allergies':'peanuts','weight':75,'height':175,'age':29,'level':'Beginner','goal':'Maintain & feel better','skin_type':'Dry','hair_type':'Curly','care_early':False,'equipment':'Gym','limitations':'','notifications':False,'timezone':'Asia/Kolkata'}

class FakeProvider:
    def __init__(self, reject=0): self.reject=reject;self.review_calls=0;self.generated=[]
    def generate(self,role,context,revision=''):
        self.generated.append((role,revision))
        categories={'workout':['Workout'],'meal':['Breakfast','Lunch','Dinner'],'care':[f for f in context['profile']['focus'] if f in ('Skin care','Hair care')]}[role]
        tasks=[{'time':f'{8+i*4:02}:00','title':category,'description':'An actionable activity','category':category,'minutes':20,'calories':600 if role=='meal' else 100 if role=='workout' else 0,'ingredients':['chickpeas'] if role=='meal' else [],'steps':['Follow the routine']} for i,category in enumerate(categories)]
        return RolePlan(summary=role,daily_calorie_target=1800 if role=='meal' else 0,daily_burn_target=100 if role=='workout' else 0,weekly_progression=['Start','Practice','Adapt','Maintain'],assumptions=['Estimate'],days=[{'day':d,'tasks':tasks} for d in range(1,8)])
    def review(self,context,plans):
        self.review_calls+=1
        reject=self.review_calls<=self.reject
        return PlanReview(approved=not reject,summary='Reviewed',issues=[{'role':'meal','major':True,'feedback':'Revise meal balance'}] if reject else [])

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setattr(server,'DATA',tmp_path)
    monkeypatch.setattr(server,'DB',tmp_path/'test.sqlite3')
    monkeypatch.setattr(server,'cache',server.Cache(tmp_path/'cache'))
    monkeypatch.setenv('SMTP_HOST','')
    with TestClient(server.app) as c: yield c

def signup(client,email='alex@example.com'):
    r=client.post('/api/auth/signup',json={'name':'Alex','email':email,'password':'password123'})
    assert r.status_code==201
    return r.json()['account']

def seed_plan(account,provider=None):
    plan=planning.generate(PROFILE,[],date(2026,10,1),provider=provider or FakeProvider())
    with server.connect() as con: con.execute('INSERT INTO plans VALUES(?,?,?)',(account['id'],json.dumps(plan),server.now()))
    return plan

def test_auth_persists_and_denies_wrong_password(client):
    signup(client)
    assert client.get('/api/me').status_code==200
    server.init_db()  # sessions survive application restart
    assert client.get('/api/me').status_code==200
    client.post('/api/auth/logout')
    assert client.get('/api/me').status_code==401
    assert client.post('/api/auth/login',json={'email':'alex@example.com','password':'wrong'}).status_code==401
    assert client.post('/api/auth/login',json={'email':'alex@example.com','password':'password123'}).status_code==200
    assert client.get('/api/admin/users').status_code==403

def test_profile_validation_duplicate_signup_and_generated_password(client):
    result=client.post('/api/auth/signup',json={'name':'Alex','email':'alex@example.com'}).json()
    assert len(result['generated_password'])>=8
    assert client.post('/api/auth/signup',json={'name':'Other','email':'alex@example.com'}).status_code==409
    assert client.put('/api/profile',json={**PROFILE,'weight':0}).status_code==422
    assert client.put('/api/profile',json={**PROFILE,'timezone':'INVALID'}).status_code==422
    assert client.put('/api/profile',json=PROFILE).status_code==200
    assert client.get('/api/me').json()['profile']['diet']==['Vegan']

def test_tasks_checkins_feedback_and_tenant_isolation(client):
    account=signup(client);plan=seed_plan(account)
    task=plan['days'][0]['tasks'][0]
    body={'date':'2026-10-01','task_id':task['id'],'status':'completed'}
    assert client.put('/api/tasks/status',json=body).status_code==200
    assert client.put('/api/tasks/status',json={**body,'task_id':'invalid'}).status_code==404
    assert client.put('/api/tasks/status',json={**body,'status':'oops'}).status_code==422
    assert client.put('/api/checkins',json={'date':'2026-10-01','water':3,'weight':74.8,'notes':'Feeling good'}).status_code==200
    assert client.post('/api/feedback',json={'text':'More meal variety'}).status_code==201
    assert client.get('/api/progress').json()['statuses'][0]['status']=='completed'
    client.post('/api/auth/logout');signup(client,'other@example.com')
    assert client.get('/api/progress').json()=={'statuses':[],'checkins':[],'history':[]}
    assert client.get('/api/plan').json()['plan'] is None
    assert client.put('/api/tasks/status',json=body).status_code==404

def test_upload_private_reencoded_and_deleted(client):
    signup(client)
    image=Image.new('RGB',(20,20),'red');buffer=io.BytesIO();image.save(buffer,'PNG')
    r=client.post('/api/media',files={'file':('../../evil.png',buffer.getvalue(),'image/png')},data={'kind':'equipment','selected_date':'2026-10-01'})
    assert r.status_code==201
    item=r.json();assert client.get(item['url']).headers['content-type']=='image/jpeg'
    assert client.post('/api/media',files={'file':('bad.png',b'not an image','image/png')},data={'kind':'body'}).status_code==422
    first_cookie=client.cookies.get('forma_session')
    client.post('/api/auth/logout');signup(client,'other@example.com')
    assert client.get(item['url']).status_code==404
    assert client.delete(item['url']).status_code==404
    client.post('/api/auth/login',json={'email':'alex@example.com','password':'password123'})
    assert client.delete(item['url']).status_code==200
    assert client.get(item['url']).status_code==404

def test_admin_crud_password_and_impersonation(client):
    assert client.post('/api/auth/login',json={'email':'admin@example.com','password':'admin123'}).status_code==200
    r=client.post('/api/admin/users',json={'name':'Alex','email':'alex@example.com'});assert r.status_code==201
    identifier=r.json()['id']
    assert len(client.get('/api/admin/users').json())==1
    assert client.put(f'/api/admin/users/{identifier}/password',json={'password':'newpassword'}).status_code==200
    assert client.post(f'/api/admin/users/{identifier}/impersonate').status_code==200
    assert client.get('/api/me').json()['account']['id']==identifier
    assert client.get('/api/admin/users').status_code==403
    assert client.post('/api/admin/return').status_code==200
    assert client.delete('/api/admin/users/'+identifier).status_code==200
    assert client.get('/api/admin/users').json()==[]

@pytest.mark.parametrize('early',[False,True])
def test_four_week_plan_care_delay_and_review_revisions(early):
    fake=FakeProvider(reject=2)
    plan=planning.generate({**PROFILE,'care_early':early},[],date(2026,10,1),provider=fake)
    assert len(plan['days'])==28
    assert plan['end_date']=='2026-10-28'
    assert plan['revisions']['meal']==2
    assert fake.review_calls==3
    assert any(t['role']=='care' for t in plan['days'][0]['tasks'])==early
    assert all(any(t['role']=='care' for t in d['tasks']) for d in plan['days'][14:])
    assert all({'Breakfast','Lunch','Dinner'}<={t['category'] for t in d['tasks']} for d in plan['days'])

def test_review_limit_never_publishes_unapproved_plan():
    fake=FakeProvider(reject=99)
    with pytest.raises(planning.PlanningError,match='three revisions'):
        planning.generate(PROFILE,[],date(2026,10,1),provider=fake)
    assert len([r for r,_ in fake.generated if r=='meal'])==4
    assert fake.review_calls==4

def test_no_workout_for_care_only_profile():
    plan=planning.generate({**PROFILE,'focus':['Skin care']},[],date(2026,10,1),provider=FakeProvider())
    assert all(t['role']!='workout' for d in plan['days'] for t in d['tasks'])

def test_background_job_persisted_and_ready_notification(client,monkeypatch):
    signup(client)
    client.put('/api/profile',json=PROFILE)
    monkeypatch.setitem(planning.PROVIDERS,'test',FakeProvider)
    monkeypatch.setenv('LLM_PROVIDER','test')
    r=client.post('/api/plans/generate');assert r.status_code==202
    for _ in range(50):
        job=client.get('/api/jobs/'+r.json()['id']).json()
        if job['status'] in ('completed','failed'): break
        time.sleep(.02)
    assert job['status']=='completed',job
    assert len(client.get('/api/plan').json()['plan']['days'])==28
    for _ in range(30):
        me=client.get('/api/me').json()
        if me['notifications']:break
        time.sleep(.02)
    assert me['notifications'][0]['email_status']=='disabled'

def test_failed_regeneration_preserves_previous_plan(client,monkeypatch):
    account=signup(client);seed_plan(account);client.put('/api/profile',json=PROFILE)
    class Fails(FakeProvider):
        def generate(self,*args,**kwargs):raise planning.PlanningError('Provider unavailable')
    monkeypatch.setitem(planning.PROVIDERS,'test',Fails);monkeypatch.setenv('LLM_PROVIDER','test')
    r=client.post('/api/plans/generate')
    for _ in range(50):
        job=client.get('/api/jobs/'+r.json()['id']).json()
        if job['status']=='failed':break
        time.sleep(.02)
    assert job['status']=='failed'
    assert len(client.get('/api/plan').json()['plan']['days'])==28


def test_successful_regeneration_archives_previous_tracking(client,monkeypatch):
    account=signup(client);old=seed_plan(account);client.put('/api/profile',json=PROFILE)
    client.put('/api/tasks/status',json={'date':old['start_date'],'task_id':old['days'][0]['tasks'][0]['id'],'status':'completed'})
    monkeypatch.setitem(planning.PROVIDERS,'test',FakeProvider);monkeypatch.setenv('LLM_PROVIDER','test')
    job_id=client.post('/api/plans/generate').json()['id']
    for _ in range(50):
        job=client.get('/api/jobs/'+job_id).json()
        if job['status'] in ('completed','failed'):break
        time.sleep(.02)
    assert job['status']=='completed',job
    history=client.get('/api/progress').json()['history']
    assert len(history)==1 and history[0]['completed']==1
    client.post('/api/auth/logout');signup(client,'other@example.com')
    assert client.get('/api/progress').json()['history']==[]


def test_admin_is_platform_staff_without_a_personal_plan(client):
    assert client.post('/api/auth/login',json={'email':'admin@example.com','password':'admin123'}).status_code==200
    me=client.get('/api/me').json()
    assert me['account']['role']=='admin'
    assert me['profile'] is None and me['plan'] is None and me['job'] is None and me['notifications']==[]
    personal=[('put','/api/profile',{**PROFILE,'email':'admin@example.com'}),('post','/api/plans/generate',None),
              ('post','/api/plans/refine',{'days':7,'preferences':'More legs'}),('post','/api/plans/extend',{'days':7,'preferences':'More legs'}),
              ('get','/api/plan',None),('get','/api/progress',None),('get','/api/preferences',None),('get','/api/media',None),
              ('put','/api/tasks/status',{'date':'2026-10-01','task_id':'meal-1','status':'completed'}),
              ('put','/api/checkins',{'date':'2026-10-01','water':2}),('post','/api/feedback',{'text':'Great'})]
    for method,path,body in personal:
        r=getattr(client,method)(path,**({'json':body} if body is not None else {}))
        assert r.status_code==403,(path,r.status_code)
    assert client.get('/api/admin/users').status_code==200
    assert client.put('/api/auth/password',json={'password':'admin12345'}).status_code==200
    # "Login as" uses the member's own session, so the member's workspace stays reachable.
    member=client.post('/api/admin/users',json={'name':'Alex','email':'alex@example.com'}).json()['id']
    assert client.post(f"/api/admin/users/{member}/impersonate").status_code==200
    assert client.put('/api/profile',json=PROFILE).status_code==200
    assert client.get('/api/progress').status_code==200


def test_provider_role_schemas_reject_cross_role_tasks_and_invalid_times():
    from backend.models import MealPlan, WorkoutPlan, CarePlan
    from pydantic import ValidationError
    fake=FakeProvider()
    context={'profile':PROFILE}
    def with_nutrition(data):
        data['daily_nutrition_targets']={'protein_g':90,'carbs_g':225,'fat_g':60,'fiber_g':30}
        for day in data['days']:
            for task in day['tasks']: task['nutrition']={'protein_g':30,'carbs_g':75,'fat_g':20,'fiber_g':10}
        return data
    for role,schema in [('workout',WorkoutPlan),('meal',MealPlan),('care',CarePlan)]:
        data=fake.generate(role,context).model_dump()
        if role=='meal': with_nutrition(data)
        assert schema.model_validate(data)
        data['days'][0]['tasks'][0]['category']='Workout' if role!='workout' else 'Dinner'
        with pytest.raises(ValidationError): schema.model_validate(data)
    data=with_nutrition(fake.generate('meal',context).model_dump())
    data['days'][0]['tasks'][0]['time']='8:00 AM'
    with pytest.raises(ValidationError): MealPlan.model_validate(data)
