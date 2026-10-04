"""The team. Each role is a LangChain tool-calling agent with its own prompt and tool permissions."""
import re
from dataclasses import dataclass

from langchain.agents import create_agent
from langchain_core.messages import AIMessage

from . import cli_agent, codex_cli, db, llm, memory
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
    commands: bool = False  # read-only roles that may still run commands (tests, builds)


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

VERIFIER = Role("verifier", True, """Role: Independent Verifier / QA.
Decide whether the task is ACTUALLY done, judged on the current state of the code, not on anyone's summary.
You are given every request in the task's conversation; all of them must be satisfied.
- Turn the requests into a checklist of concrete requirements.
- Check each one yourself: read the code, and run the tests / build / the program where possible.
- Do not modify, create or delete files; you only inspect and run checks.
Report: the checklist, each item marked [x] met / [ ] not met / [~] partly, with evidence (file:line,
command + result). Then list the gaps, if any, as concrete fixes. End with exactly one line:
VERIFICATION: DONE   or   VERIFICATION: PARTIAL   or   VERIFICATION: NOT_DONE""", commands=True)

ROLES = {r.name: r for r in (PLANNER, CODER, REVIEWER, VERIFIER)}


class Cancelled(Exception):
    pass


def check_cancelled(task_id: int) -> None:
    t = db.get_task(task_id)
    if t and t["status"] == "cancelled":
        raise Cancelled()


def run_role(role: Role, task: dict, brief: str, changed: set | None = None,
             session: str | None = None) -> tuple[str, str | None]:
    """Run one agent to completion on `brief`, logging its activity to the task's event stream.
    Returns (answer, session id). Passing the role's previous session id resumes its conversation,
    so follow-up turns (and review rounds) continue where the agent left off."""
    tid, meta = task["id"], task["metadata"] or {}
    log = lambda kind, msg: db.add_event(tid, role.name, kind, msg)
    log("status", f"started ({meta.get('model', '?')})")
    changed = changed if changed is not None else set()

    if llm.is_mock():
        out = mock_output(role, task)
        log("message", out)
        return out, None

    system_prompt = (COMMON.format(root=settings.workspace_root, project=meta.get("project", "general"))
                     + "\n\n" + role.prompt)
    if settings.backend in ("claude", "codex"):
        def cancelled():
            t = db.get_task(tid)
            return t is not None and t["status"] == "cancelled"
        tier = meta.get("model_tier", "balanced")
        try:
            if settings.backend == "claude":
                return cli_agent.run(role.name, system_prompt, brief, settings.model_for_tier(tier),
                                     meta.get("project"), log, changed, cancelled, session)
            return codex_cli.run(role.name, system_prompt, brief, tier, meta.get("project"), log, changed,
                                 cancelled, session)
        except InterruptedError:
            raise Cancelled()

    # langchain backend: the agent's message history lives in the checkpointer, one thread per task+role.
    thread = f"{tid}:{role.name}"
    if session:
        log("status", "resuming conversation")
    agent = create_agent(
        llm.model_for(meta.get("model_tier", "balanced")),
        make_tools(role.read_only, log, changed, commands=role.commands),
        system_prompt=system_prompt,
        name=role.name,
        checkpointer=memory.checkpointer,
    )
    final = ""
    for update in agent.stream({"messages": [("user", brief)]}, stream_mode="updates",
                               config={"recursion_limit": settings.agent_max_steps * 2,
                                       "configurable": {"thread_id": thread}}):
        check_cancelled(tid)
        for node in update.values():
            for m in (node or {}).get("messages", []):
                if isinstance(m, AIMessage) and m.text:
                    final = m.text
                    if m.tool_calls:  # interim thinking-out-loud between tool calls
                        log("message", m.text)
    log("message", final)
    return final, thread


def verification_state(report: str) -> str:
    """done | partial | not_done from the verifier's last VERIFICATION line ("error" if missing)."""
    m = re.findall(r"VERIFICATION:\s*(DONE|PARTIAL|NOT_DONE)", report)
    return m[-1].lower() if m else "error"


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
    if role.name == "verifier":
        return "[mock] - [x] request handled (mock provider)\nVERIFICATION: DONE"
    return "[mock] Looks consistent with the plan.\nVERDICT: APPROVED"
