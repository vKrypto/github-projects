"""FastAPI application. Run .venv/bin/python -m backend.server from the repo root."""
import hashlib, hmac, io, json, os, secrets, shutil, smtplib, sqlite3, threading, time, uuid
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / '.env')
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Response, Cookie
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from .models import Signup, Login, Profile, TaskStatus, CheckIn, Feedback, PasswordChange, PlanAdjustment
from .cache import Cache
from . import planning
from .plan_updates import adjustment_window, merge_adjustment

DATA = Path(os.getenv('FORMA_DATA_DIR', str(Path(__file__).parent / 'data'))).resolve()
DATA.mkdir(parents=True,exist_ok=True)
DB=DATA/'phase1.sqlite3'
cache=Cache(DATA/'cache')
executor=ThreadPoolExecutor(max_workers=2)
COOKIE='forma_session'
SECURE=os.getenv('COOKIE_SECURE','false').lower()=='true'

def now(): return datetime.now(timezone.utc).isoformat()
def today(tz='Asia/Kolkata'): return datetime.now(ZoneInfo(tz)).date()
def connect():
    con=sqlite3.connect(DB, timeout=30)
    con.row_factory=sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    return con

def init_db():
    with connect() as con:
        con.execute('PRAGMA journal_mode=WAL')
        con.executescript('''
        CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, account TEXT REFERENCES accounts(id) ON DELETE CASCADE, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS profiles(tenant TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS plans(tenant TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, data TEXT NOT NULL, created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS plan_history(id TEXT PRIMARY KEY, tenant TEXT REFERENCES accounts(id) ON DELETE CASCADE, data TEXT NOT NULL, statuses TEXT NOT NULL, created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, tenant TEXT REFERENCES accounts(id) ON DELETE CASCADE, status TEXT, message TEXT, created TEXT, updated TEXT);
        CREATE TABLE IF NOT EXISTS job_audit(id TEXT PRIMARY KEY, job TEXT REFERENCES jobs(id) ON DELETE CASCADE, tenant TEXT REFERENCES accounts(id) ON DELETE CASCADE, data TEXT NOT NULL, created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS statuses(tenant TEXT REFERENCES accounts(id) ON DELETE CASCADE, date TEXT, task_id TEXT, status TEXT, PRIMARY KEY(tenant,date,task_id));
        CREATE TABLE IF NOT EXISTS checkins(tenant TEXT REFERENCES accounts(id) ON DELETE CASCADE, date TEXT, water INTEGER, weight REAL, notes TEXT, PRIMARY KEY(tenant,date));
        CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY, tenant TEXT REFERENCES accounts(id) ON DELETE CASCADE, kind TEXT, date TEXT, filename TEXT, created TEXT);
        CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY, tenant TEXT REFERENCES accounts(id) ON DELETE CASCADE, text TEXT, created TEXT);
        CREATE TABLE IF NOT EXISTS plan_preferences(id TEXT PRIMARY KEY, tenant TEXT REFERENCES accounts(id) ON DELETE CASCADE, text TEXT NOT NULL, action TEXT NOT NULL, days INTEGER NOT NULL, created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, tenant TEXT REFERENCES accounts(id) ON DELETE CASCADE, message TEXT, created TEXT, email_status TEXT);
        ''')
        job_columns = {r['name'] for r in con.execute('PRAGMA table_info(jobs)')}
        for column, declaration in [('action', "TEXT NOT NULL DEFAULT 'generate'"), ('start_date', 'TEXT'), ('days', 'INTEGER NOT NULL DEFAULT 28'), ('preferences_id', 'TEXT')]:
            if column not in job_columns:
                con.execute(f'ALTER TABLE jobs ADD COLUMN {column} {declaration}')
        email=os.getenv('ADMIN_EMAIL','admin@example.com').lower()
        if not con.execute('SELECT id FROM accounts WHERE email=?',(email,)).fetchone():
            con.execute('INSERT INTO accounts VALUES(?,?,?,?,?,?)',(str(uuid.uuid4()),email,'Administrator',hash_password(os.getenv('ADMIN_PASSWORD','admin123')),'admin',now()))
        con.execute("UPDATE jobs SET status='failed',message='Server restarted during planning. Please retry.',updated=? WHERE status IN ('queued','generating','reviewing','revising')",(now(),))

def hash_password(value):
    salt=secrets.token_hex(16)
    digest=hashlib.pbkdf2_hmac('sha256',value.encode(),salt.encode(),310000).hex()
    return salt+':'+digest

def verify_password(value,stored):
    salt,digest=stored.split(':')
    candidate=hashlib.pbkdf2_hmac('sha256',value.encode(),salt.encode(),310000).hex()
    return hmac.compare_digest(candidate,digest)

def issue_session(response,account):
    token=secrets.token_urlsafe(40)
    with connect() as con:
        con.execute('DELETE FROM sessions WHERE expires<?',(time.time(),))
        con.execute('INSERT INTO sessions VALUES(?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),account,time.time()+30*86400))
    response.set_cookie(COOKIE,token,httponly=True,secure=SECURE,samesite='lax',max_age=30*86400,path='/')
    return token

def resolve_session(token):
    if not token: raise HTTPException(401,'Please sign in.')
    with connect() as con:
        row=con.execute('SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.account WHERE s.token=? AND s.expires>?',(hashlib.sha256(token.encode()).hexdigest(),time.time())).fetchone()
    if not row: raise HTTPException(401,'Your session expired. Please sign in.')
    return dict(row)

def current(forma_session: str | None=Cookie(default=None)): return resolve_session(forma_session)
def admin(account=Depends(current)):
    if account['role']!='admin': raise HTTPException(403,'Administrator access required.')
    return account
# Administrators are platform staff: they manage users and guides but never
# have a profile, plan or tracking of their own. "Login as" switches to the
# member's own session, so impersonation still reaches these endpoints.
def member(account=Depends(current)):
    if account['role']=='admin': raise HTTPException(403,'Administrators manage the platform and do not have a personal plan.')
    return account

def public(account): return {k:account[k] for k in ('id','email','name','role','created')}
def load_profile(tenant):
    with connect() as con: row=con.execute('SELECT data FROM profiles WHERE tenant=?',(tenant,)).fetchone()
    return json.loads(row['data']) if row else None

def load_plan(tenant):
    value=cache.get(tenant,'plan')
    if value: return value
    with connect() as con: row=con.execute('SELECT data FROM plans WHERE tenant=?',(tenant,)).fetchone()
    if not row: return None
    value=json.loads(row['data']);cache.set(tenant,'plan',value)
    return value

def check_date(value):
    try: return date.fromisoformat(value).isoformat()
    except ValueError: raise HTTPException(422,'Invalid date. Use YYYY-MM-DD.') from None

def notification(tenant,message):
    identifier=str(uuid.uuid4())
    with connect() as con:
        con.execute('INSERT INTO notifications VALUES(?,?,?,?,?)',(identifier,tenant,message,now(),'queued'))
    deliver_notification(identifier)

def deliver_notification(identifier):
    with connect() as con:
        row=con.execute('SELECT n.*,a.email FROM notifications n JOIN accounts a ON a.id=n.tenant WHERE n.id=?',(identifier,)).fetchone()
    if not row: return
    profile=load_profile(row['tenant']) or {}
    status='disabled' if not profile.get('notifications',True) else 'not_configured'
    if profile.get('notifications',True) and os.getenv('SMTP_HOST'):
        try:
            msg=EmailMessage();msg['Subject']='Your Forma plan is ready';msg['From']=os.getenv('SMTP_FROM','forma@localhost');msg['To']=row['email'];msg.set_content(row['message']+'\n\nOpen your Forma dashboard to view your plan.')
            with smtplib.SMTP(os.environ['SMTP_HOST'],int(os.getenv('SMTP_PORT','587')),timeout=15) as smtp:
                if os.getenv('SMTP_TLS','true').lower()=='true': smtp.starttls()
                if os.getenv('SMTP_USER'): smtp.login(os.environ['SMTP_USER'],os.getenv('SMTP_PASSWORD',''))
                smtp.send_message(msg)
            status='sent'
        except Exception: status='failed'
    with connect() as con: con.execute('UPDATE notifications SET email_status=? WHERE id=?',(status,identifier))

def load_preferences(tenant):
    with connect() as con:
        return [dict(r) for r in con.execute('SELECT id,text,action,days,created FROM plan_preferences WHERE tenant=? ORDER BY rowid', (tenant,))]


def run_job(identifier, tenant, profile, action='generate', start=None, count=28, base_plan=None, preference=''):
    def report(status, message, details=None):
        with connect() as con:
            con.execute('UPDATE jobs SET status=?,message=?,updated=? WHERE id=?', (status,message,now(),identifier))
            if details is not None:
                con.execute('INSERT INTO job_audit VALUES(?,?,?,?,?)', (str(uuid.uuid4()),identifier,tenant,json.dumps(details),now()))
    try:
        start = start or today(profile['timezone'])
        with connect() as con:
            images = [dict(r) for r in con.execute("SELECT * FROM media WHERE tenant=? AND kind IN ('equipment','body') ORDER BY created DESC", (tenant,))]
            for image in images:
                image['path'] = str(DATA/'media'/tenant/image['filename'])
            previous = [dict(r) for r in con.execute('SELECT date,task_id,status FROM statuses WHERE tenant=?', (tenant,))]
            feedback = [dict(r) for r in con.execute('SELECT text FROM feedback WHERE tenant=? ORDER BY created DESC LIMIT 5', (tenant,))]
        context_plan = {}
        journey_offset = 0
        if base_plan:
            context_plan = {k:v for k,v in base_plan.items() if k not in ('days','reviews','changes')}
            if action == 'refine':
                end = (start + timedelta(days=count-1)).isoformat()
                context_plan['days'] = [d for d in base_plan['days'] if start.isoformat() <= d['date'] <= end]
            else:
                context_plan['days'] = base_plan['days'][-7:]
            if action != 'generate':
                journey_offset = max(0, (start-date.fromisoformat(base_plan['start_date'])).days)
        generated = planning.generate(profile, images, start, {'tasks':previous,'feedback':feedback}, report,
            days_count=count, journey_offset=journey_offset, preferences=load_preferences(tenant),
            current_plan=context_plan, action=action)
        with connect() as con:
            con.execute('BEGIN IMMEDIATE')
            stored_profile = con.execute('SELECT data FROM profiles WHERE tenant=?', (tenant,)).fetchone()
            if not stored_profile or json.loads(stored_profile['data']) != profile:
                raise planning.PlanningError('Profile changed during planning. Please retry with the updated profile.')
            old = con.execute('SELECT data FROM plans WHERE tenant=?', (tenant,)).fetchone()
            old_plan = json.loads(old['data']) if old else None
            if old_plan != base_plan:
                raise planning.PlanningError('Your plan changed during planning. Please retry against the current version.')
            old_statuses = [dict(r) for r in con.execute('SELECT date,task_id,status FROM statuses WHERE tenant=?', (tenant,))]
            if old:
                con.execute('INSERT INTO plan_history VALUES(?,?,?,?,?)', (str(uuid.uuid4()),tenant,old['data'],json.dumps(old_statuses),now()))
            plan = generated if action == 'generate' else merge_adjustment(old_plan, generated, action, old_statuses, identifier, preference, now())
            con.execute('INSERT OR REPLACE INTO plans VALUES(?,?,?)', (tenant,json.dumps(plan),now()))
            if action == 'generate':
                con.execute('DELETE FROM statuses WHERE tenant=? AND date BETWEEN ? AND ?', (tenant,generated['start_date'],generated['end_date']))
            elif action == 'refine':
                affected_dates = {d['date'] for d in generated['days']}
                valid = {(d['date'],t['id']) for d in plan['days'] if d['date'] in affected_dates for t in d['tasks']}
                for row in old_statuses:
                    if row['date'] in affected_dates and (row['date'],row['task_id']) not in valid:
                        con.execute('DELETE FROM statuses WHERE tenant=? AND date=? AND task_id=?', (tenant,row['date'],row['task_id']))
        cache.delete(tenant,'plan')
        cache.set(tenant,'plan',plan)
        message = 'Your reviewed four-week plan is ready.' if action == 'generate' else f'Your plan has been {"refined" if action == "refine" else "extended"} for {count} days: {generated["start_date"]} to {generated["end_date"]}.'
        notification(tenant, message)
        report('completed', message)
    except planning.PlanningError as e:
        report('failed', str(e))
    except Exception:
        report('failed', 'Planning could not finish. Your previous plan is still available and your preference note is saved. Please retry.')


def queue_job(account, action='generate', adjustment=None, preferences_id=None):
    tenant = account['id']
    profile = load_profile(tenant)
    if not profile:
        raise HTTPException(400, 'Complete onboarding first.')
    if os.getenv('LLM_PROVIDER','openai') not in planning.PROVIDERS:
        raise HTTPException(503, 'Configured planning provider is unavailable.')
    current_plan = load_plan(tenant)
    count = adjustment.days if adjustment else 28
    start = today(profile['timezone'])
    if action != 'generate':
        try:
            start = adjustment_window(current_plan, action, count, start)
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
    identifier = str(uuid.uuid4())
    note = adjustment.preferences if adjustment else ''
    with connect() as con:
        con.execute('BEGIN IMMEDIATE')
        if con.execute("SELECT id FROM jobs WHERE tenant=? AND status IN ('queued','generating','reviewing','revising')", (tenant,)).fetchone():
            raise HTTPException(409, 'A plan is already being prepared.')
        if adjustment and not preferences_id:
            preferences_id = str(uuid.uuid4())
            con.execute('INSERT INTO plan_preferences VALUES(?,?,?,?,?,?)', (preferences_id,tenant,note,action,count,now()))
        con.execute('INSERT INTO jobs(id,tenant,status,message,created,updated,action,start_date,days,preferences_id) VALUES(?,?,?,?,?,?,?,?,?,?)',
            (identifier,tenant,'queued','Planning is queued.',now(),now(),action,start.isoformat(),count,preferences_id))
    executor.submit(run_job, identifier, tenant, profile, action, start, count, current_plan, note)
    return {'id':identifier,'status':'queued','message':'Planning is queued.','action':action,
            'days':count,'start_date':start.isoformat(),'end_date':(start+timedelta(days=count-1)).isoformat()}


@asynccontextmanager
async def lifespan(app):
    init_db()
    yield

app=FastAPI(title='Forma Phase 1',version='1.0.0',lifespan=lifespan)
app.add_middleware(CORSMiddleware,allow_origins=[os.getenv('FRONTEND_URL','http://localhost:5173')],allow_credentials=True,allow_methods=['GET','POST','PUT','DELETE'],allow_headers=['Content-Type'])

@app.get('/api/health')
def health(): return {'status':'ok','database':'sqlite','cache':'redis+file-fallback' if cache.redis else 'file','llm':os.getenv('LLM_PROVIDER','openai'),'openai_configured':bool(os.getenv('OPEN_API_KEY') or os.getenv('OPENAI_API_KEY')),'email_configured':bool(os.getenv('SMTP_HOST'))}

@app.post('/api/auth/signup',status_code=201)
def signup(data: Signup,response: Response):
    password=data.password or secrets.token_urlsafe(12)
    if len(password)<8: raise HTTPException(422,'Use a password with at least eight characters.')
    identifier=str(uuid.uuid4())
    try:
        with connect() as con: con.execute('INSERT INTO accounts VALUES(?,?,?,?,?,?)',(identifier,str(data.email).lower(),data.name.strip(),hash_password(password),'user',now()))
    except sqlite3.IntegrityError: raise HTTPException(409,'An account with this email already exists. Please sign in.') from None
    issue_session(response,identifier)
    account={'id':identifier,'email':str(data.email).lower(),'name':data.name.strip(),'role':'user','created':now()}
    return {'account':account,'generated_password':password if not data.password else None}

@app.post('/api/auth/login')
def login(data:Login,response:Response):
    with connect() as con: row=con.execute('SELECT * FROM accounts WHERE email=?',(str(data.email).lower(),)).fetchone()
    if not row or not verify_password(data.password,row['password']): raise HTTPException(401,'Incorrect email or password.')
    issue_session(response,row['id'])
    return {'account':public(dict(row))}

@app.post('/api/auth/logout')
def logout(response:Response,forma_session:str | None=Cookie(default=None)):
    if forma_session:
        with connect() as con: con.execute('DELETE FROM sessions WHERE token=?',(hashlib.sha256(forma_session.encode()).hexdigest(),))
    response.delete_cookie(COOKIE);response.delete_cookie('forma_admin')
    return {'saved':True}

@app.get('/api/me')
def me(account=Depends(current),forma_admin:str | None=Cookie(default=None)):
    if account['role']=='admin':
        return {'account':public(account),'profile':None,'plan':None,'job':None,'notifications':[],'preferences':[],'impersonating':False}
    with connect() as con:
        job=con.execute('SELECT * FROM jobs WHERE tenant=? ORDER BY created DESC LIMIT 1',(account['id'],)).fetchone()
        notices=[dict(r) for r in con.execute('SELECT * FROM notifications WHERE tenant=? ORDER BY created DESC LIMIT 10',(account['id'],))]
    return {'account':public(account),'profile':load_profile(account['id']),'plan':load_plan(account['id']),'job':dict(job) if job else None,'notifications':notices,'preferences':load_preferences(account['id']),'impersonating':bool(forma_admin) and account['role']!='admin'}

@app.put('/api/profile')
def save_profile(data:Profile,account=Depends(member)):
    try: ZoneInfo(data.timezone)
    except Exception: raise HTTPException(422,'Invalid timezone.') from None
    if 'Vegan' in data.diet and 'Vegetarian' in data.diet:
        data.diet.remove('Vegetarian')
    with connect() as con:
        try: con.execute('UPDATE accounts SET name=?,email=? WHERE id=?',(data.name.strip(),str(data.email).lower(),account['id']))
        except sqlite3.IntegrityError: raise HTTPException(409,'Email is already in use.') from None
        con.execute('INSERT OR REPLACE INTO profiles VALUES(?,?)',(account['id'],data.model_dump_json()))
    return data.model_dump()

@app.put('/api/auth/password')
def password(data:PasswordChange,account=Depends(current)):
    with connect() as con:
        con.execute('UPDATE accounts SET password=? WHERE id=?',(hash_password(data.password),account['id']))
    return {'saved':True}

@app.post('/api/plans/generate',status_code=202)
def start_plan(account=Depends(member)):
    return queue_job(account)

@app.post('/api/plans/refine',status_code=202)
def refine_plan(data:PlanAdjustment,account=Depends(member)):
    return queue_job(account,'refine',data)

@app.post('/api/plans/extend',status_code=202)
def extend_plan(data:PlanAdjustment,account=Depends(member)):
    return queue_job(account,'extend',data)

@app.get('/api/preferences')
def preferences(account=Depends(member)):
    return load_preferences(account['id'])

@app.post('/api/jobs/{identifier}/retry',status_code=202)
def retry_job(identifier:str,account=Depends(member)):
    with connect() as con:
        row=con.execute('SELECT * FROM jobs WHERE id=? AND tenant=?',(identifier,account['id'])).fetchone()
        if not row: raise HTTPException(404,'Planning job not found.')
        if row['status']!='failed': raise HTTPException(409,'Only failed jobs can be retried.')
        preference=con.execute('SELECT text FROM plan_preferences WHERE id=? AND tenant=?',(row['preferences_id'],account['id'])).fetchone() if row['preferences_id'] else None
    adjustment=PlanAdjustment(days=row['days'],preferences=preference['text']) if preference else None
    return queue_job(account,row['action'],adjustment,row['preferences_id'])

@app.get('/api/jobs/{identifier}')
def job(identifier:str,account=Depends(member)):
    with connect() as con: row=con.execute('SELECT * FROM jobs WHERE id=? AND tenant=?',(identifier,account['id'])).fetchone()
    if not row: raise HTTPException(404,'Planning job not found.')
    return dict(row)

@app.get('/api/plan')
def get_plan(account=Depends(member)): return {'plan':load_plan(account['id'])}

@app.get('/api/progress')
def progress(account=Depends(member)):
    with connect() as con:
        statuses=[dict(r) for r in con.execute('SELECT date,task_id,status FROM statuses WHERE tenant=?',(account['id'],))]
        checkins=[dict(r) for r in con.execute('SELECT date,water,weight,notes FROM checkins WHERE tenant=? ORDER BY date',(account['id'],))]
    with connect() as con: archived=con.execute('SELECT id,data,statuses,created FROM plan_history WHERE tenant=? ORDER BY created DESC',(account['id'],)).fetchall()
    history=[]
    for row in archived:
        old_plan=json.loads(row['data']);old_statuses={(s['date'],s['task_id']):s['status'] for s in json.loads(row['statuses'])}
        completed=sum(old_statuses.get((d['date'],t['id']))=='completed' for d in old_plan['days'] for t in d['tasks'])
        skipped=sum(old_statuses.get((d['date'],t['id']))=='skipped' for d in old_plan['days'] for t in d['tasks'])
        total=sum(len(d['tasks']) for d in old_plan['days'])
        history.append({'id':row['id'],'start_date':old_plan['start_date'],'end_date':old_plan['end_date'],'completed':completed,'skipped':skipped,'total':total,'adherence':round(completed/max(1,total)*100)})
    return {'statuses':statuses,'checkins':checkins,'history':history}

@app.put('/api/tasks/status')
def task_status(data:TaskStatus,account=Depends(member)):
    selected=check_date(data.date)
    plan=load_plan(account['id'])
    day=next((d for d in (plan or {}).get('days',[]) if d['date']==selected),None)
    if not day or data.task_id not in [t['id'] for t in day['tasks']]: raise HTTPException(404,'Task not found in your plan.')
    with connect() as con: con.execute('INSERT OR REPLACE INTO statuses VALUES(?,?,?,?)',(account['id'],selected,data.task_id,data.status))
    return {'saved':True}

@app.put('/api/checkins')
def checkin(data:CheckIn,account=Depends(member)):
    check_date(data.date)
    with connect() as con: con.execute('INSERT OR REPLACE INTO checkins VALUES(?,?,?,?,?)',(account['id'],data.date,data.water,data.weight,data.notes))
    return {'saved':True}

@app.post('/api/feedback',status_code=201)
def feedback(data:Feedback,account=Depends(member)):
    with connect() as con: con.execute('INSERT INTO feedback VALUES(?,?,?,?)',(str(uuid.uuid4()),account['id'],data.text,now()))
    return {'saved':True}

@app.post('/api/media',status_code=201)
async def upload(file:UploadFile=File(...),kind:str=Form(...),selected_date:str=Form(default=''),account=Depends(member)):
    if kind not in ('equipment','body','progress'): raise HTTPException(422,'Invalid image purpose.')
    selected_date=check_date(selected_date) if selected_date else today().isoformat()
    raw=await file.read(10*1024*1024+1)
    await file.close()
    if len(raw)>10*1024*1024: raise HTTPException(413,'Images must be smaller than 10 MB.')
    try:
        image=Image.open(io.BytesIO(raw))
        if image.width*image.height>30_000_000: raise ValueError('Image dimensions too large')
        from PIL import ImageOps
        image=ImageOps.exif_transpose(image).convert('RGB')
        image.thumbnail((1600,1600))
    except (UnidentifiedImageError,OSError,ValueError,Image.DecompressionBombError): raise HTTPException(422,'Upload a valid JPEG, PNG or WebP image.') from None
    identifier=str(uuid.uuid4());filename=identifier+'.jpg'
    directory=DATA/'media'/account['id'];directory.mkdir(parents=True,exist_ok=True)
    image.save(directory/filename,'JPEG',quality=88)
    with connect() as con: con.execute('INSERT INTO media VALUES(?,?,?,?,?,?)',(identifier,account['id'],kind,selected_date,filename,now()))
    return {'id':identifier,'kind':kind,'date':selected_date,'url':'/api/media/'+identifier}

@app.get('/api/media')
def media(account=Depends(member)):
    with connect() as con: rows=con.execute('SELECT id,kind,date,created FROM media WHERE tenant=? ORDER BY created DESC',(account['id'],)).fetchall()
    return [{**dict(r),'url':'/api/media/'+r['id']} for r in rows]

@app.get('/api/media/{identifier}')
def get_media(identifier:str,account=Depends(member)):
    with connect() as con: row=con.execute('SELECT filename FROM media WHERE id=? AND tenant=?',(identifier,account['id'])).fetchone()
    if not row: raise HTTPException(404,'Image not found.')
    return FileResponse(DATA/'media'/account['id']/row['filename'],media_type='image/jpeg',headers={'Cache-Control':'private, no-store'})

@app.delete('/api/media/{identifier}')
def delete_media(identifier:str,account=Depends(member)):
    with connect() as con:
        row=con.execute('SELECT filename FROM media WHERE id=? AND tenant=?',(identifier,account['id'])).fetchone()
        if not row: raise HTTPException(404,'Image not found.')
        con.execute('DELETE FROM media WHERE id=?',(identifier,))
    (DATA/'media'/account['id']/row['filename']).unlink(missing_ok=True)
    return {'saved':True}

@app.get('/api/admin/users')
def users(account=Depends(admin)):
    with connect() as con: rows=con.execute("SELECT a.id,a.email,a.name,a.created,p.tenant IS NOT NULL AS onboarded FROM accounts a LEFT JOIN profiles p ON a.id=p.tenant WHERE a.role='user' ORDER BY a.created DESC").fetchall()
    return [dict(r) for r in rows]

@app.post('/api/admin/users',status_code=201)
def add_user(data:Signup,response:Response,account=Depends(admin)):
    password=data.password or secrets.token_urlsafe(12)
    if len(password)<8: raise HTTPException(422,'Use a password with at least eight characters.')
    identifier=str(uuid.uuid4())
    try:
        with connect() as con: con.execute('INSERT INTO accounts VALUES(?,?,?,?,?,?)',(identifier,str(data.email).lower(),data.name.strip(),hash_password(password),'user',now()))
    except sqlite3.IntegrityError: raise HTTPException(409,'Email already exists.') from None
    return {'id':identifier,'generated_password':password if not data.password else None}

@app.put('/api/admin/users/{identifier}/password')
def set_password(identifier:str,data:PasswordChange,account=Depends(admin)):
    with connect() as con:
        cursor=con.execute("UPDATE accounts SET password=? WHERE id=? AND role='user'",(hash_password(data.password),identifier))
        if not cursor.rowcount: raise HTTPException(404,'User not found.')
        con.execute('DELETE FROM sessions WHERE account=?',(identifier,))
    return {'saved':True}

@app.post('/api/admin/users/{identifier}/impersonate')
def impersonate(identifier:str,response:Response,account=Depends(admin),forma_session:str | None=Cookie(default=None)):
    with connect() as con: row=con.execute("SELECT * FROM accounts WHERE id=? AND role='user'",(identifier,)).fetchone()
    if not row: raise HTTPException(404,'User not found.')
    response.set_cookie('forma_admin',forma_session,httponly=True,secure=SECURE,samesite='lax',max_age=86400,path='/')
    issue_session(response,identifier)
    return {'account':public(dict(row))}

@app.post('/api/admin/return')
def return_admin(response:Response,forma_admin:str | None=Cookie(default=None)):
    account=resolve_session(forma_admin)
    if account['role']!='admin': raise HTTPException(403,'Administrator access required.')
    response.set_cookie(COOKIE,forma_admin,httponly=True,secure=SECURE,samesite='lax',max_age=86400,path='/')
    response.delete_cookie('forma_admin')
    return {'account':public(account)}

@app.delete('/api/admin/users/{identifier}')
def delete_user(identifier:str,account=Depends(admin)):
    with connect() as con:
        if con.execute("SELECT id FROM jobs WHERE tenant=? AND status IN ('queued','generating','reviewing','revising')",(identifier,)).fetchone(): raise HTTPException(409,'Wait for this user’s planning job to finish before deleting.')
        cursor=con.execute("DELETE FROM accounts WHERE id=? AND role='user'",(identifier,))
        if not cursor.rowcount: raise HTTPException(404,'User not found.')
    cache.delete(identifier,'plan')
    shutil.rmtree(DATA/'media'/identifier,ignore_errors=True)
    shutil.rmtree(DATA/'cache'/identifier,ignore_errors=True)
    return {'saved':True}

if __name__=='__main__':
    import uvicorn
    uvicorn.run('backend.server:app',host='127.0.0.1',port=8000)
