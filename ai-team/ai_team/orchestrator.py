"""Orchestrator: pulls queued tasks and runs the team graph on them, up to max_parallel at a time."""
import logging
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor

from . import db
from .agents import VERIFIER, Cancelled, run_role, verification_state
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


def _history(task_id: int, before_turn: int, limit: int = 1500) -> str:
    """Earlier turns as compact text, for agents joining a follow-up without a session of their own."""
    lines = []
    for m in db.list_messages(task_id):
        if m["turn"] < before_turn:
            text = m["content"] if len(m["content"]) <= limit else m["content"][:limit] + " …"
            lines.append(f"[turn {m['turn']} · {m['role']}] {text}")
    return "\n\n".join(lines)


def _outcome(state: dict, workflow: list[str]) -> str:
    """The turn's answer for the conversation: what was done and the review verdict / plan / answer."""
    if "coder" in workflow:
        out = state.get("result") or ""
        if state.get("review"):
            out += "\n\n— Review —\n" + state["review"]
        return out.strip()
    if "reviewer" in workflow and state.get("review"):
        return state["review"]
    return state.get("plan") or ""


def run_task(task: dict) -> None:
    tid, turn = task["id"], task.get("turn") or 1
    request = next((m["content"] for m in reversed(db.list_messages(tid))
                    if m["turn"] == turn and m["role"] == "user"), task["text"])
    db.add_event(tid, "orchestrator", "status", f"picked up (turn {turn})")
    wf = (task["metadata"] or {}).get("workflow", [])
    # Same thread every turn: the checkpointer restores plan/result/sessions from earlier turns.
    # Per-turn fields are reset here.
    config = {"configurable": {"thread_id": str(tid)}}
    turn_input = {"task": task, "turn": turn, "request": request, "history": _history(tid, turn),
                  "rounds": 0, "approved": False, "review": "", "changed_files": []}
    try:
        final = team_graph.invoke(turn_input, config)
        if db.get_task(tid)["status"] == "cancelled":
            raise Cancelled()
        db.add_message(tid, turn, "assistant", _outcome(final, wf) or "(no output)")
        if "coder" in wf and "reviewer" in wf and not final.get("approved"):
            db.update_task(tid, status="failed", finished_at=db.now(),
                           error=f"reviewer did not approve after {settings.max_review_rounds} round(s)")
        else:
            db.update_task(tid, status="done", finished_at=db.now())
        db.add_event(tid, "orchestrator", "status", f"finished turn {turn}")
    except Cancelled:
        db.add_event(tid, "orchestrator", "status", "cancelled")
        db.add_message(tid, turn, "system", "cancelled")
        db.update_task(tid, finished_at=db.now())
    except Exception as e:
        log.exception("task %s failed", tid)
        db.update_task(tid, status="failed", error=f"{type(e).__name__}: {e}", finished_at=db.now())
        db.add_message(tid, turn, "system", f"failed: {type(e).__name__}: {e}")
        db.add_event(tid, "orchestrator", "error", traceback.format_exc()[-4000:])


def verify_task(task: dict) -> None:
    """Independent check of whether the task is actually done, against the current code.
    Never changes the task's status; records a verdict (done | partial | not_done) and a report."""
    tid, turn = task["id"], task.get("turn") or 1
    db.add_event(tid, "orchestrator", "status", "verification started")
    requests = [f"[turn {m['turn']}] {m['content']}" for m in db.list_messages(tid) if m["role"] == "user"]
    state = team_graph.get_state({"configurable": {"thread_id": str(tid)}}).values or {}
    files = state.get("all_changed_files") or state.get("changed_files") or []
    brief = ("Verify whether this task is done. All of these requests must be satisfied:\n\n"
             + "\n\n".join(requests))
    if files:
        brief += "\n\nFiles the team changed while working on it:\n" + "\n".join(f"- {f}" for f in files)
    if task.get("result"):
        brief += f"\n\nThe developer's last summary (claims to check, not facts):\n{task['result']}"
    try:
        report, _ = run_role(VERIFIER, task, brief)  # fresh session: an independent look every time
        verdict = verification_state(report)
        db.update_task(tid, verify_state=verdict, verification=report, verified_at=db.now())
        db.add_message(tid, turn, "verifier", report)
        db.add_event(tid, "orchestrator", "status", f"verification: {verdict.upper()}")
    except Exception as e:
        log.exception("verification of task %s failed", tid)
        db.update_task(tid, verify_state="error", verification=f"{type(e).__name__}: {e}", verified_at=db.now())
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
            job = db.claim_next_job()
            if job is None:
                self.slots.release()
                self.stop.wait(settings.poll_interval)
                continue
            self.pool.submit(self._run, *job)

    def _run(self, kind: str, task: dict):
        try:
            (verify_task if kind == "verify" else run_task)(task)
        finally:
            self.slots.release()
