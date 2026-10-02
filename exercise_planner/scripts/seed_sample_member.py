"""Create the sample member account, fill its onboarding and prepare a reviewed plan.

Administrators are platform staff without plans, so the sample lives in a
regular member account. The script signs in as the administrator, creates the
member if needed, and works through "Login as".
Run from the repository root: .venv/bin/python scripts/seed_sample_member.py
Existing profiles and plans are preserved; this script is safe to rerun.
"""
import os, time
from pathlib import Path
import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / '.env')
client = httpx.Client(base_url=os.getenv('FORMA_API_URL','http://127.0.0.1:8000'), timeout=30)
email = os.getenv('SAMPLE_EMAIL','sample@example.com')
response = client.post('/api/auth/login',json={'email':os.getenv('ADMIN_EMAIL','admin@example.com'),'password':os.getenv('ADMIN_PASSWORD','admin123')})
response.raise_for_status()
member = next((u for u in client.get('/api/admin/users').json() if u['email']==email), None)
if member is None:
    response = client.post('/api/admin/users',json={'name':'Sample Member','email':email,'password':os.getenv('SAMPLE_PASSWORD','sample123')})
    response.raise_for_status()
    member = {'id':response.json()['id']}
    print('Created sample member',email,flush=True)
client.post(f"/api/admin/users/{member['id']}/impersonate").raise_for_status()
me = client.get('/api/me').json()
assert me['account']['role']=='user' and me['account']['email']==email
if not me['profile']:
    profile = {
        'name':'Sample Member', 'email':email,
        'focus':['Physique','Overall wellness','Skin care','Hair care'],
        'body_areas':['Arms','Legs','Torso'], 'custom_area':'Core stability and balanced strength',
        'diet':['Vegetarian'], 'allergies':'None',
        'weight':75,'height':175,'age':29,'level':'Beginner',
        'goal':'Maintain & feel better','skin_type':'Combination','hair_type':'Wavy',
        'care_early':False,'equipment':'Gym access with dumbbells, bench, treadmill and cable machine',
        'limitations':'No known limitations',
        'notifications':False,'timezone':'Asia/Kolkata'
    }
    client.put('/api/profile',json=profile).raise_for_status()
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
        plan=client.get('/api/me').json()['plan']
        assert len(plan['days'])==28 and plan['reviews'][-1]['approved']
        assert all(not any(t['role']=='care' for t in d['tasks']) for d in plan['days'][:14])
        print('Verified: 28 reviewed days; care starts in week 3.',flush=True)
        print('Plan dates:',plan['start_date'],'to',plan['end_date'],flush=True)
        break
    time.sleep(3)
else: raise SystemExit('Planning is still running. Rerun this script to resume checking it.')
