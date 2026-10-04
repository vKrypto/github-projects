"""The team. Each role is a LangChain tool-calling agent with its own prompt and tool permissions."""
import re
from dataclasses import dataclass

from langchain.agents import create_agent
from langchain_core.messages import AIMessage

from . import db, llm
from .config import settings
from .tools import make_tools

COMMON = """You are part of an autonomous AI software team. You are a senior engineer and own your part of the work.
Workspace root: {root}. All paths are relative to it; each top-level folder is a separate project/repo.
Target project: {project}. Stay inside the workspace. Do not use git in any way; the human handles version control.
Be concise in your final answer: it is handed to the next teammate and shown on a dashboard."""


@dataclass(frozen=True)
class Role:
    name: str
    read_only: bool
    prompt: str


PLANNER = Role("planner", True, """Role: Tech Lead / Planner.
Explore the relevant code first (list_dir, search, read_file), then produce an implementation plan:
- Context: what exists today that matters (files, functions, conventions)
- Steps: numbered, concrete, naming the files to touch
- Risks / open questions
- Acceptance criteria the reviewer will check
If the task is a question or research, answer it fully instead of planning code changes.
You cannot modify files.""")

CODER = Role("coder", False, """Role: Senior Developer.
Implement the plan. Match the existing code style; make minimal, focused changes. Prefer edit_file for
existing files. Run the project's tests/linters/build with run_command when available and fix what you break.
If you received reviewer feedback, address every point.
Final answer: a summary of what changed (file list + one line each) and how you verified it.""")

REVIEWER = Role("reviewer", True, """Role: Senior Code Reviewer.
Review the work against the task, the plan and its acceptance criteria. Read every file the developer
changed (listed in your brief), then surrounding code as needed. For review-only tasks, review the code the task points at.
Check correctness, edge cases, security, and consistency with surrounding code. Be specific (file:line).
End your answer with exactly one line:
VERDICT: APPROVED   or   VERDICT: CHANGES_REQUESTED""")

ROLES = {r.name: r for r in (PLANNER, CODER, REVIEWER)}


class Cancelled(Exception):
    pass


def check_cancelled(task_id: int) -> None:
    t = db.get_task(task_id)
    if t and t["status"] == "cancelled":
        raise Cancelled()


def run_role(role: Role, task: dict, brief: str, changed: set | None = None) -> str:
    """Run one agent to completion on `brief`, logging its activity to the task's event stream."""
    tid, meta = task["id"], task["metadata"] or {}
    log = lambda kind, msg: db.add_event(tid, role.name, kind, msg)
    log("status", f"started ({meta.get('model', '?')})")

    if llm.is_mock():
        out = mock_output(role, task)
        log("message", out)
        return out

    agent = create_agent(
        llm.model_for(meta.get("model_tier", "balanced")),
        make_tools(role.read_only, log, changed),
        system_prompt=COMMON.format(root=settings.workspace_root, project=meta.get("project", "general"))
        + "\n\n" + role.prompt,
        name=role.name,
    )
    final = ""
    for update in agent.stream({"messages": [("user", brief)]}, stream_mode="updates",
                               config={"recursion_limit": settings.agent_max_steps * 2}):
        check_cancelled(tid)
        for node in update.values():
            for m in (node or {}).get("messages", []):
                if isinstance(m, AIMessage) and m.text:
                    final = m.text
                    if m.tool_calls:  # interim thinking-out-loud between tool calls
                        log("message", m.text)
    log("message", final)
    return final


def verdict(review: str) -> bool:
    m = re.findall(r"VERDICT:\s*(APPROVED|CHANGES_REQUESTED)", review)
    return bool(m) and m[-1] == "APPROVED"


def mock_output(role: Role, task: dict) -> str:
    meta = task["metadata"] or {}
    if role.name == "planner":
        return (f"[mock] Plan for: {task['text']}\n1. Inspect `{meta.get('project')}`\n2. Make the change\n"
                f"3. Add/adjust tests\nAcceptance: behaviour matches the request.")
    if role.name == "coder":
        return "[mock] No files changed (mock provider). Would implement the plan above."
    return "[mock] Looks consistent with the plan.\nVERDICT: APPROVED"
