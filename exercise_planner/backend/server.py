"""Forma's local API. Run: python backend/server.py"""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
import sqlite3, json, uuid, hashlib, secrets, datetime, os

ROOT = Path(__file__).parent
DATA = ROOT / 'data'
DATA.mkdir(exist_ok=True)
DB = DATA / 'forma.sqlite3'
SESSIONS = {}

def connect():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    return con

with connect() as con:
    con.executescript('''
    CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, data TEXT, created TEXT);
    CREATE TABLE IF NOT EXISTS plans(tenant TEXT PRIMARY KEY, data TEXT, created TEXT);
    CREATE TABLE IF NOT EXISTS task_status(tenant TEXT, date TEXT, task_id INTEGER, status TEXT, PRIMARY KEY(tenant,date,task_id));
    CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY, tenant TEXT, date TEXT, filename TEXT);
    ''')

def generate_plan(profile):
    """Separate planning roles with bounded review; provider interface can be extended."""
    diet = profile.get('diet', 'No preference')
    allergies = profile.get('allergies', '').lower()
    meals = ['Greek yogurt & berry bowl', 'Grilled chicken quinoa bowl', 'Salmon & roasted vegetables']
    if diet == 'Vegetarian': meals = ['Oatmeal & berry bowl', 'Chickpea quinoa bowl', 'Lentil & roasted vegetable bowl']
    if diet == 'Vegan': meals = ['Oatmeal & berry bowl', 'Chickpea quinoa bowl', 'Lentil & roasted vegetable bowl']
    if diet == 'Gluten-free': meals = ['Yogurt & berry bowl', 'Chicken rice bowl', 'Salmon & roasted vegetables']
    # Explicit allergies require review rather than silently producing an unsafe menu.
    review = 'Review ingredients and portions before following this sample plan.'
    if allergies and allergies not in ('none', 'no', 'n/a'):
        meals = ['Breakfast — allergy-safe selection needed', 'Lunch — allergy-safe selection needed', 'Dinner — allergy-safe selection needed']
        review = 'Allergy details saved. Meal selection requires ingredient review before use.'
    days = []
    start = datetime.date.today()
    for i in range(28):
        rest = i % 7 in (2, 6)
        tasks = [
            dict(id=1,time='7:00 AM',title='Morning mobility',desc='Gentle full-body movement at a comfortable pace.',type='Workout',duration='15 min',cal=60,icon='stretch'),
            dict(id=2,time='8:00 AM',title=meals[0],desc=review,type='Breakfast',duration='Meal',cal=None,icon='meal'),
            dict(id=3,time='12:30 PM',title=meals[1],desc=review,type='Lunch',duration='Meal',cal=None,icon='meal'),
            dict(id=4,time='5:30 PM',title='Recovery walk' if rest else ('Upper body strength' if i%2==0 else 'Lower body strength'),desc='Choose a comfortable intensity; stop if you feel pain.',type='Workout',duration='20 min' if rest else '45 min',cal=None,icon='workout'),
            dict(id=5,time='7:30 PM',title=meals[2],desc=review,type='Dinner',duration='Meal',cal=None,icon='meal')]
        days.append(dict(date=(start+datetime.timedelta(days=i)).isoformat(),tasks=tasks))
    return dict(provider='local-sample', days=days, review=review, care_start_day=15, roles=['workout','meal','care','review'], max_review_loops=3)

class Handler(BaseHTTPRequestHandler):
    def send(self, status, value):
        payload = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Access-Control-Allow-Origin','http://localhost:5173')
        self.end_headers()
        self.wfile.write(payload)
    def body(self):
        length=int(self.headers.get('Content-Length',0))
        if length > 15_000_000: raise ValueError('Request too large')
        return json.loads(self.rfile.read(length) or '{}')
    def do_GET(self):
        if self.path == '/api/health': return self.send(200,dict(status='ok',storage='sqlite',cache='file'))
        return self.send(404,dict(error='Not found'))
    def do_POST(self):
        try:
            data=self.body()
            if self.path == '/api/profiles':
                if not data.get('name') or '@' not in data.get('email',''): return self.send(400,dict(error='Name and valid email required'))
                tenant=str(uuid.uuid4())
                data['id']=tenant
                token=secrets.token_urlsafe(32)
                SESSIONS[token]=tenant
                plan=generate_plan(data)
                now=datetime.datetime.now(datetime.timezone.utc).isoformat()
                with connect() as con:
                    con.execute('INSERT INTO profiles VALUES(?,?,?,?,?)',(tenant,data['email'],data['name'],json.dumps(data),now))
                    con.execute('INSERT INTO plans VALUES(?,?,?)',(tenant,json.dumps(plan),now))
                folder=DATA/'media'/tenant
                folder.mkdir(parents=True,exist_ok=True)
                cache=DATA/'cache'/tenant
                cache.mkdir(parents=True,exist_ok=True)
                (cache/'plan.json').write_text(json.dumps(plan))
                return self.send(201,dict(profile=data,token=token,plan=plan))
            tenant=SESSIONS.get(self.headers.get('Authorization','').removeprefix('Bearer '))
            if not tenant: return self.send(401,dict(error='Session required'))
            if self.path == '/api/tasks/status':
                date=datetime.date.fromisoformat(data['date']).isoformat()
                if data['status'] not in ('pending','completed','skipped'): raise ValueError('Invalid status')
                with connect() as con: con.execute('INSERT OR REPLACE INTO task_status VALUES(?,?,?,?)',(tenant,date,int(data['task_id']),data['status']))
                return self.send(200,dict(saved=True))
            if self.path == '/api/plan':
                with connect() as con:
                    plan=con.execute('SELECT data FROM plans WHERE tenant=?',(tenant,)).fetchone()
                return self.send(200,json.loads(plan['data']))
            if self.path == '/api/progress':
                with connect() as con:
                    rows=con.execute('SELECT date,task_id,status FROM task_status WHERE tenant=?',(tenant,)).fetchall()
                return self.send(200,[dict(r) for r in rows])
            return self.send(404,dict(error='Not found'))
        except sqlite3.IntegrityError: self.send(409,dict(error='Email already has a profile'))
        except (ValueError,KeyError,TypeError) as e: self.send(400,dict(error=str(e)))

if __name__ == '__main__':
    print('Forma API at http://127.0.0.1:8000')
    ThreadingHTTPServer(('127.0.0.1',8000),Handler).serve_forever()
