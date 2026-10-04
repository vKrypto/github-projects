"""HTTP API + dashboard. Run: .venv/bin/python -m ai_team"""
from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import db
from .config import APP_DIR, settings
from .orchestrator import Orchestrator, triage_task
from .tools import list_projects

orchestrator = Orchestrator()


@asynccontextmanager
async def lifespan(app: FastAPI):
    orchestrator.start()
    for t in db.list_tasks(status="triaging"):  # interrupted by a restart
        triage_task(t["id"])
    yield
    orchestrator.shutdown()


app = FastAPI(title="AI Team", lifespan=lifespan)


class NewTask(BaseModel):
    text: str = Field(min_length=3, max_length=20_000)


def _get(task_id: int) -> dict:
    t = db.get_task(task_id)
    if not t:
        raise HTTPException(404, "task not found")
    return t


@app.get("/")
def dashboard():
    return FileResponse(APP_DIR / "dashboard" / "index.html")


@app.post("/api/tasks", status_code=201)
def create_task(body: NewTask, bg: BackgroundTasks):
    task = db.create_task(body.text.strip())
    bg.add_task(triage_task, task["id"])
    return task


@app.get("/api/tasks")
def list_tasks(status: str | None = None, task_type: str | None = None, project: str | None = None,
               q: str | None = None):
    return db.list_tasks(status, task_type, project, q)


@app.get("/api/tasks/{task_id}")
def get_task(task_id: int):
    return _get(task_id)


@app.get("/api/tasks/{task_id}/events")
def task_events(task_id: int, after: int = 0):
    _get(task_id)
    return db.list_events(task_id, after)


@app.post("/api/tasks/{task_id}/cancel")
def cancel_task(task_id: int):
    t = _get(task_id)
    if t["status"] not in ("triaging", "queued", "running"):
        raise HTTPException(409, f"cannot cancel a {t['status']} task")
    db.update_task(task_id, status="cancelled", finished_at=db.now() if t["status"] != "running" else None)
    db.add_event(task_id, "user", "status", "cancel requested")
    return db.get_task(task_id)


@app.post("/api/tasks/{task_id}/retry")
def retry_task(task_id: int, bg: BackgroundTasks):
    t = _get(task_id)
    if t["status"] not in ("failed", "cancelled", "done"):
        raise HTTPException(409, f"cannot retry a {t['status']} task")
    # Re-triage too: provider/models may have changed since the first run.
    db.update_task(task_id, status="triaging", metadata=None, project=None, task_type=None, error=None,
                   plan=None, result=None, review=None, started_at=None, finished_at=None)
    db.add_event(task_id, "user", "status", "retry requested")
    bg.add_task(triage_task, task_id)
    return db.get_task(task_id)


@app.get("/api/meta")
def meta():
    return {
        "counts": db.counts(),
        "projects": list_projects(),
        "task_types": db.distinct("task_type"),
        "provider": settings.provider,
        "workspace_root": str(settings.workspace_root),
        "max_parallel": settings.max_parallel,
    }
