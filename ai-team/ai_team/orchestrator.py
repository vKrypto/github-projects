"""Orchestrator: pulls queued tasks and runs the team graph on them, up to max_parallel at a time."""
import logging
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor

from . import db
from .agents import Cancelled
from .config import settings
from .graph import team_graph
from .triage import triage

log = logging.getLogger("ai_team.orchestrator")


def triage_task(task_id: int) -> None:
    """Classify a newly submitted task, then queue it."""
    task = db.get_task(task_id)
    try:
        meta = triage(task["text"])
        db.update_task(task_id, metadata=meta, project=meta["project"], task_type=meta["task_type"], status="queued")
        db.add_event(task_id, "triage", "status",
                     f"{meta['task_type']} · {meta['project']} · {' → '.join(meta['workflow'])} · "
                     f"{meta['model_tier']} ({meta['model']}) — {meta['rationale']}")
    except Exception as e:
        log.exception("triage failed for task %s", task_id)
        db.update_task(task_id, status="failed", error=f"triage: {e}", finished_at=db.now())
        db.add_event(task_id, "triage", "error", traceback.format_exc()[-4000:])


def run_task(task: dict) -> None:
    tid = task["id"]
    db.add_event(tid, "orchestrator", "status", "picked up")
    try:
        final = team_graph.invoke({"task": task, "rounds": 0})
        if db.get_task(tid)["status"] == "cancelled":
            raise Cancelled()
        wf = (task["metadata"] or {}).get("workflow", [])
        if "coder" in wf and "reviewer" in wf and not final.get("approved"):
            db.update_task(tid, status="failed", finished_at=db.now(),
                           error=f"reviewer did not approve after {settings.max_review_rounds} round(s)")
        else:
            db.update_task(tid, status="done", finished_at=db.now())
        db.add_event(tid, "orchestrator", "status", "finished")
    except Cancelled:
        db.add_event(tid, "orchestrator", "status", "cancelled")
        db.update_task(tid, finished_at=db.now())
    except Exception as e:
        log.exception("task %s failed", tid)
        db.update_task(tid, status="failed", error=f"{type(e).__name__}: {e}", finished_at=db.now())
        db.add_event(tid, "orchestrator", "error", traceback.format_exc()[-4000:])


class Orchestrator:
    def __init__(self):
        self.stop = threading.Event()
        self.slots = threading.Semaphore(settings.max_parallel)
        self.pool = ThreadPoolExecutor(max_workers=settings.max_parallel, thread_name_prefix="agent")
        self.thread = threading.Thread(target=self._loop, name="orchestrator", daemon=True)

    def start(self):
        db.requeue_running()
        self.thread.start()

    def shutdown(self):
        self.stop.set()
        self.pool.shutdown(wait=False, cancel_futures=True)

    def _loop(self):
        while not self.stop.is_set():
            if not self.slots.acquire(timeout=settings.poll_interval):
                continue
            task = db.claim_next_queued()
            if task is None:
                self.slots.release()
                self.stop.wait(settings.poll_interval)
                continue
            self.pool.submit(self._run, task)

    def _run(self, task):
        try:
            run_task(task)
        finally:
            self.slots.release()
