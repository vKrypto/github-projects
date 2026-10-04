"""SQLite task store: tasks + an append-only event log per task."""
import json
import sqlite3
import threading
from datetime import datetime, timezone

from .config import settings

STATUSES = ("triaging", "queued", "running", "done", "failed", "cancelled")

_lock = threading.Lock()
_conn = sqlite3.connect(settings.db_path, check_same_thread=False, isolation_level=None)
_conn.row_factory = sqlite3.Row
_conn.execute("PRAGMA journal_mode=WAL")
_conn.executescript(
    """
    CREATE TABLE IF NOT EXISTS tasks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        text        TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'triaging',
        metadata    TEXT,              -- JSON from triage
        project     TEXT,
        task_type   TEXT,
        plan        TEXT,
        result      TEXT,              -- coder summary
        review      TEXT,              -- final reviewer verdict
        error       TEXT,
        created_at  TEXT NOT NULL,
        started_at  TEXT,
        finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id),
        ts      TEXT NOT NULL,
        agent   TEXT NOT NULL,
        kind    TEXT NOT NULL,         -- status | message | tool | error
        content TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);
    """
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row(r: sqlite3.Row | None) -> dict | None:
    if r is None:
        return None
    d = dict(r)
    d["metadata"] = json.loads(d["metadata"]) if d.get("metadata") else None
    return d


def create_task(text: str) -> dict:
    with _lock:
        cur = _conn.execute("INSERT INTO tasks (text, created_at) VALUES (?, ?)", (text, now()))
    return get_task(cur.lastrowid)


def get_task(task_id: int) -> dict | None:
    return _row(_conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone())


def list_tasks(status: str | None = None, task_type: str | None = None, project: str | None = None,
               q: str | None = None) -> list[dict]:
    sql, args = "SELECT * FROM tasks WHERE 1=1", []
    for col, val in (("status", status), ("task_type", task_type), ("project", project)):
        if val:
            sql += f" AND {col} = ?"
            args.append(val)
    if q:
        sql += " AND text LIKE ?"
        args.append(f"%{q}%")
    return [_row(r) for r in _conn.execute(sql + " ORDER BY id DESC", args).fetchall()]


def update_task(task_id: int, **fields) -> None:
    if "metadata" in fields and not isinstance(fields["metadata"], str):
        fields["metadata"] = json.dumps(fields["metadata"])
    cols = ", ".join(f"{k} = ?" for k in fields)
    with _lock:
        _conn.execute(f"UPDATE tasks SET {cols} WHERE id = ?", (*fields.values(), task_id))


def claim_next_queued() -> dict | None:
    """Atomically move the oldest queued task to running and return it."""
    with _lock:
        r = _conn.execute("SELECT id FROM tasks WHERE status = 'queued' ORDER BY id LIMIT 1").fetchone()
        if r is None:
            return None
        _conn.execute("UPDATE tasks SET status = 'running', started_at = ?, error = NULL WHERE id = ?",
                      (now(), r["id"]))
    return get_task(r["id"])


def requeue_running() -> None:
    """On startup, tasks left 'running' by a crash go back to the queue."""
    with _lock:
        _conn.execute("UPDATE tasks SET status = 'queued' WHERE status = 'running'")


def add_event(task_id: int, agent: str, kind: str, content: str) -> None:
    with _lock:
        _conn.execute("INSERT INTO events (task_id, ts, agent, kind, content) VALUES (?, ?, ?, ?, ?)",
                      (task_id, now(), agent, kind, content))


def list_events(task_id: int, after_id: int = 0) -> list[dict]:
    rows = _conn.execute("SELECT * FROM events WHERE task_id = ? AND id > ? ORDER BY id",
                         (task_id, after_id)).fetchall()
    return [dict(r) for r in rows]


def counts() -> dict:
    rows = _conn.execute("SELECT status, COUNT(*) n FROM tasks GROUP BY status").fetchall()
    return {s: 0 for s in STATUSES} | {r["status"]: r["n"] for r in rows}


def distinct(col: str) -> list[str]:
    assert col in ("project", "task_type")
    return [r[0] for r in _conn.execute(f"SELECT DISTINCT {col} FROM tasks WHERE {col} IS NOT NULL ORDER BY 1")]
