"""The per-task LangGraph workflow: planner -> coder -> reviewer, looping coder<->reviewer on rejection.

Triage decides which agents a task needs (`workflow`); routing skips the rest.

The graph is compiled with a checkpointer (memory.py) and run with thread_id = task id, so a task's
state survives between runs. Each follow-up ("continue chat") is another invoke on the same thread:
plan/result/review and every agent's session id carry over, and each agent resumes its own session.

    START ─► planner ─► coder ─► reviewer ─► END
               │          ▲          │
               │          └─changes──┘  (max_review_rounds)
               └──────────(no coder)───► reviewer / END
"""
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from . import db, memory
from .agents import CODER, PLANNER, REVIEWER, check_cancelled, run_role, verdict
from .config import settings


class TeamState(TypedDict, total=False):
    task: dict
    turn: int                  # 1 = original request, 2+ = follow-ups
    request: str               # what to do in this turn
    history: str               # earlier turns, summarised (for agents that have no session yet)
    plan: str
    result: str
    review: str
    approved: bool
    rounds: int                # coder runs within this turn
    changed_files: list[str]   # files changed within this turn
    all_changed_files: list[str]  # files changed across all turns (for verification)
    sessions: dict             # role -> CLI session id / langchain thread, resumed on later runs


def _wf(state: TeamState) -> list[str]:
    return (state["task"]["metadata"] or {}).get("workflow") or ["planner", "coder", "reviewer"]


def _request(state: TeamState) -> str:
    if state.get("turn", 1) <= 1:
        return f"Task:\n{state['task']['text']}"
    return (f"Original task:\n{state['task']['text']}\n\n"
            f"Earlier turns of this conversation:\n{state.get('history') or '(none)'}\n\n"
            f"NEW follow-up request (turn {state['turn']}) - this is what to do now:\n{state['request']}")


def _run(role, state: TeamState, brief: str, changed: set | None = None) -> tuple[str, dict]:
    sessions = dict(state.get("sessions") or {})
    out, sessions[role.name] = run_role(role, state["task"], brief, changed, sessions.get(role.name))
    return out, sessions


def planner_node(state: TeamState) -> TeamState:
    check_cancelled(state["task"]["id"])
    brief = _request(state)
    if state.get("turn", 1) > 1:
        brief += "\n\nPlan only what this follow-up needs, building on the work already done."
    plan, sessions = _run(PLANNER, state, brief)
    db.update_task(state["task"]["id"], plan=plan)
    return {"plan": plan, "sessions": sessions}


def coder_node(state: TeamState) -> TeamState:
    task = state["task"]
    check_cancelled(task["id"])
    brief = f"{_request(state)}\n\nPlan from the tech lead:\n{state.get('plan') or '(none)'}"
    if state.get("review") and state.get("rounds", 0) > 0:
        brief += f"\n\nReviewer feedback on your previous attempt (address all of it):\n{state['review']}"
    changed = set(state.get("changed_files", []))
    result, sessions = _run(CODER, state, brief, changed)
    db.update_task(task["id"], result=result)
    db.add_event(task["id"], "coder", "status", "files changed: " + (", ".join(sorted(changed)) or "none"))
    return {"result": result, "rounds": state.get("rounds", 0) + 1, "changed_files": sorted(changed),
            "all_changed_files": sorted(changed | set(state.get("all_changed_files") or [])),
            "sessions": sessions}


def reviewer_node(state: TeamState) -> TeamState:
    task = state["task"]
    check_cancelled(task["id"])
    brief = _request(state)
    if state.get("plan"):
        brief += f"\n\nPlan:\n{state['plan']}"
    if state.get("result") and state.get("rounds", 0) > 0:
        brief += f"\n\nDeveloper's summary:\n{state['result']}"
    if state.get("changed_files"):
        brief += "\n\nFiles changed by the developer:\n" + "\n".join(f"- {f}" for f in state["changed_files"])
    review, sessions = _run(REVIEWER, state, brief)
    db.update_task(task["id"], review=review)
    return {"review": review, "approved": verdict(review), "sessions": sessions}


def after_planner(state: TeamState) -> str:
    wf = _wf(state)
    return "coder" if "coder" in wf else "reviewer" if "reviewer" in wf else END


def after_coder(state: TeamState) -> str:
    return "reviewer" if "reviewer" in _wf(state) else END


def after_reviewer(state: TeamState) -> str:
    if state["approved"] or "coder" not in _wf(state) or state.get("rounds", 0) >= settings.max_review_rounds:
        return END
    db.add_event(state["task"]["id"], "orchestrator", "status",
                 f"review requested changes, sending back to coder (round {state.get('rounds', 0) + 1})")
    return "coder"


def entry(state: TeamState) -> str:
    return _wf(state)[0]


def build_graph():
    g = StateGraph(TeamState)
    g.add_node("planner", planner_node)
    g.add_node("coder", coder_node)
    g.add_node("reviewer", reviewer_node)
    g.add_conditional_edges(START, entry, ["planner", "coder", "reviewer"])
    g.add_conditional_edges("planner", after_planner, ["coder", "reviewer", END])
    g.add_conditional_edges("coder", after_coder, ["reviewer", END])
    g.add_conditional_edges("reviewer", after_reviewer, ["coder", END])
    return g.compile(checkpointer=memory.checkpointer)


team_graph = build_graph()
