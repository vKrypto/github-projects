"""Fill the administrator's own onboarding and create a reviewed plan.
Run from the repository root: .venv/bin/python scripts/seed_admin_sample.py
Existing profiles are preserved; this script is safe to rerun.
"""
import os, time
from pathlib import Path
import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / '.env')
client = httpx.Client(base_url=os.getenv('FORMA_API_URL','http://127.0.0.1:8000'), timeout=30)
email = os.getenv('ADMIN_EMAIL','admin@example.com')
response = client.post('/api/auth/login',json={'email':email,'password':os.getenv('ADMIN_PASSWORD','admin')})
response.raise_for_status()
me = client.get('/api/me').json()
if not me['profile']:
    profile = {
        'name':'Administrator (Sample)', 'email':email,
        'focus':['Physique','Overall wellness','Skin care','Hair care'],
        'body_areas':['Arms','Legs','Torso'], 'custom_area':'Core stability and balanced strength',
        'diet':['Vegetarian'], 'allergies':'None',
        'weight':75,'height':175,'age':29,'level':'Beginner',
        'goal':'Maintain & feel better','skin_type':'Combination','hair_type':'Wavy',
        'care_early':False,'equipment':'Gym access with dumbbells, bench, treadmill and cable machine',
        'limitations':'No known limitations',
        'notifications':False,'timezone':'Asia/Kolkata'
    }
    response=client.put('/api/profile',json=profile)
    response.raise_for_status()
    print('Sample onboarding saved for',email,flush=True)
else:
    print('Existing onboarding preserved for',email,flush=True)
if me['plan']:
    print('Existing plan preserved:',len(me['plan']['days']),'days',flush=True)
    raise SystemExit(0)
if me.get('job') and me['job']['status'] in ('queued','generating','reviewing','revising'):
    identifier=me['job']['id']
else:
    response=client.post('/api/plans/generate')
    response.raise_for_status()
    identifier=response.json()['id']
last=None
for _ in range(240):
    response=client.get('/api/jobs/'+identifier)
    response.raise_for_status()
    job=response.json()
    if job['status']!=last:
        print(job['status']+': '+job['message'],flush=True)
        last=job['status']
    if job['status']=='failed': raise SystemExit('Planning failed: '+job['message'])
    if job['status']=='completed':
        me=client.get('/api/me').json()
        plan=me['plan']
        assert me['account']['role']=='admin'
        assert len(plan['days'])==28 and plan['reviews'][-1]['approved']
        assert all(not any(t['role']=='care' for t in d['tasks']) for d in plan['days'][:14])
        print('Verified: administrator access preserved; 28 reviewed days; care starts in week 3.',flush=True)
        print('Plan dates:',plan['start_date'],'to',plan['end_date'],flush=True)
        break
    time.sleep(3)
else: raise SystemExit('Planning is still running. Rerun this script to resume checking it.')
