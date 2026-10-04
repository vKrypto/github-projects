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
    -- The task's conversation: turn 1 is the original request, later turns are follow-ups.
    CREATE TABLE IF NOT EXISTS messages (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id),
        turn    INTEGER NOT NULL,
        role    TEXT NOT NULL,         -- user | assistant | system
        content TEXT NOT NULL,
        ts      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id);
    """
)
# Migrations for databases created before these columns existed.
_cols = {r["name"] for r in _conn.execute("PRAGMA table_info(tasks)")}
for _col, _ddl in (("verify_state", "TEXT"),     # NULL | queued | running | done | partial | not_done | error
                   ("verification", "TEXT"),     # the verifier's report
                   ("verified_at", "TEXT")):
    if _col not in _cols:
        _conn.execute(f"ALTER TABLE tasks ADD COLUMN {_col} {_ddl}")
if "turn" not in _cols:
    _conn.execute("ALTER TABLE tasks ADD COLUMN turn INTEGER NOT NULL DEFAULT 1")
    _conn.execute("INSERT INTO messages (task_id, turn, role, content, ts) "
                  "SELECT id, 1, 'user', text, created_at FROM tasks")


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
        _conn.execute("INSERT INTO messages (task_id, turn, role, content, ts) VALUES (?, 1, 'user', ?, ?)",
                      (cur.lastrowid, text, now()))
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


def claim_next_job() -> tuple[str, dict] | None:
    """Atomically claim the oldest pending job: ("run", task) for a queued turn, or ("verify", task)
    for a queued verification. Returns None when there is nothing to do."""
    with _lock:
        r = _conn.execute("SELECT id, status, verify_state FROM tasks WHERE status = 'queued' "
                          "OR verify_state = 'queued' ORDER BY id LIMIT 1").fetchone()
        if r is None:
            return None
        if r["status"] == "queued":
            _conn.execute("UPDATE tasks SET status = 'running', started_at = ?, error = NULL WHERE id = ?",
                          (now(), r["id"]))
            return "run", get_task(r["id"])
        _conn.execute("UPDATE tasks SET verify_state = 'running' WHERE id = ?", (r["id"],))
    return "verify", get_task(r["id"])


def requeue_running() -> None:
    """On startup, work left 'running' by a crash goes back to the queue."""
    with _lock:
        _conn.execute("UPDATE tasks SET status = 'queued' WHERE status = 'running'")
        _conn.execute("UPDATE tasks SET verify_state = 'queued' WHERE verify_state = 'running'")


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


def add_message(task_id: int, turn: int, role: str, content: str) -> None:
    with _lock:
        _conn.execute("INSERT INTO messages (task_id, turn, role, content, ts) VALUES (?, ?, ?, ?, ?)",
                      (task_id, turn, role, content, now()))


def list_messages(task_id: int) -> list[dict]:
    rows = _conn.execute("SELECT * FROM messages WHERE task_id = ? ORDER BY id", (task_id,)).fetchall()
    return [dict(r) for r in rows]


def delete_messages(task_id: int, from_turn: int, roles: tuple[str, ...] = ("user", "assistant", "system")) -> None:
    marks = ",".join("?" * len(roles))
    with _lock:
        _conn.execute(f"DELETE FROM messages WHERE task_id = ? AND turn >= ? AND role IN ({marks})",
                      (task_id, from_turn, *roles))
