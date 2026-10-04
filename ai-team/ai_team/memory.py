"""Orchestrator memory: a LangGraph SQLite checkpointer (data/checkpoints.db).

Thread ids:
  "<task_id>"         the team graph's state for a task (plan, result, review, files, agent sessions)
  "<task_id>:<role>"  a langchain-backend agent's message history, so follow-ups resume it
CLI backends keep their own transcripts (data/claude-home, data/codex) and are resumed by session id.
"""
import sqlite3

from langgraph.checkpoint.sqlite import SqliteSaver

from .config import settings

ROLES = ("planner", "coder", "reviewer")

checkpointer = SqliteSaver(sqlite3.connect(settings.checkpoint_db, check_same_thread=False))
checkpointer.setup()


def forget_task(task_id: int) -> None:
    """Drop all orchestrator/agent memory for a task (used when it is retried from scratch)."""
    for thread in (str(task_id), *(f"{task_id}:{r}" for r in ROLES)):
        checkpointer.delete_thread(thread)
