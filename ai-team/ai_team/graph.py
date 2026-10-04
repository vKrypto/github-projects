"""The per-task LangGraph workflow: planner -> coder -> reviewer, looping coder<->reviewer on rejection.

Triage decides which agents a task needs (`workflow`); routing skips the rest.

    START ─► planner ─► coder ─► reviewer ─► END
               │          ▲          │
               │          └─changes──┘  (max_review_rounds)
               └──────────(no coder)───► reviewer / END
"""
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from . import db
from .agents import CODER, PLANNER, REVIEWER, check_cancelled, run_role, verdict
from .config import settings


class TeamState(TypedDict, total=False):
    task: dict
    plan: str
    result: str
    review: str
    approved: bool
    rounds: int
    changed_files: list[str]


def _wf(state: TeamState) -> list[str]:
    return (state["task"]["metadata"] or {}).get("workflow") or ["planner", "coder", "reviewer"]


def planner_node(state: TeamState) -> TeamState:
    check_cancelled(state["task"]["id"])
    plan = run_role(PLANNER, state["task"], f"Task:\n{state['task']['text']}")
    db.update_task(state["task"]["id"], plan=plan)
    return {"plan": plan}


def coder_node(state: TeamState) -> TeamState:
    task = state["task"]
    check_cancelled(task["id"])
    brief = f"Task:\n{task['text']}\n\nPlan from the tech lead:\n{state.get('plan') or '(none)'}"
    if state.get("review"):
        brief += f"\n\nReviewer feedback on your previous attempt (address all of it):\n{state['review']}"
    changed = set(state.get("changed_files", []))
    result = run_role(CODER, task, brief, changed)
    db.update_task(task["id"], result=result)
    db.add_event(task["id"], "coder", "status", "files changed: " + (", ".join(sorted(changed)) or "none"))
    return {"result": result, "rounds": state.get("rounds", 0) + 1, "changed_files": sorted(changed)}


def reviewer_node(state: TeamState) -> TeamState:
    task = state["task"]
    check_cancelled(task["id"])
    brief = f"Task:\n{task['text']}"
    if state.get("plan"):
        brief += f"\n\nPlan:\n{state['plan']}"
    if state.get("result"):
        brief += f"\n\nDeveloper's summary:\n{state['result']}"
    if state.get("changed_files"):
        brief += "\n\nFiles changed by the developer:\n" + "\n".join(f"- {f}" for f in state["changed_files"])
    review = run_role(REVIEWER, task, brief)
    db.update_task(task["id"], review=review)
    return {"review": review, "approved": verdict(review)}


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
    return g.compile()


team_graph = build_graph()
