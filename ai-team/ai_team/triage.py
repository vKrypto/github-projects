"""Triage: turn a free-text task into routing metadata (project, type, agents, model tier)."""
import re
from typing import Literal

from pydantic import BaseModel, Field

from . import cli_agent, codex_cli, llm
from .config import settings
from .tools import list_projects

TaskType = Literal["feature", "bugfix", "refactor", "review", "research", "docs", "ops", "question"]
Agent = Literal["planner", "coder", "reviewer"]


class TaskMetadata(BaseModel):
    title: str = Field(description="Short imperative title, max ~8 words")
    project: str = Field(description="Exact project folder name this task targets, or 'general' if none/several")
    task_type: TaskType
    workflow: list[Agent] = Field(
        description="Agents to run, in order. Code changes: planner, coder, reviewer. "
                    "Review-only of existing code: reviewer. Research/questions/planning: planner."
    )
    work_kind: Literal["reasoning", "coding", "mixed"] = Field(description="Dominant nature of the work")
    complexity: Literal["low", "medium", "high"]
    model_tier: Literal["fast", "balanced", "deep"] = Field(
        description="fast = trivial/mechanical, balanced = typical dev work, deep = hard reasoning/architecture"
    )
    rationale: str = Field(description="One sentence on why these choices")


PROMPT = """You triage tasks for an AI software team. Classify the task below.

Projects available (folder names in the workspace):
{projects}

Task:
{text}"""


def triage(text: str) -> dict:
    projects = list_projects()
    prompt = PROMPT.format(projects="\n".join(f"- {p}" for p in projects), text=text)
    if llm.is_mock():
        meta = heuristic(text, projects)
    elif settings.backend == "claude":
        meta = TaskMetadata.model_validate(
            cli_agent.structured(prompt, TaskMetadata.model_json_schema(), settings.cli_model_triage))
    elif settings.backend == "codex":
        meta = TaskMetadata.model_validate(codex_cli.structured(prompt, TaskMetadata.model_json_schema()))
    else:
        model = llm.get_model(settings.model_triage).with_structured_output(
            TaskMetadata, method="function_calling")  # tool calling works across gateway-routed models
        meta = model.invoke(prompt)
    if not llm.is_mock():
        if meta.project not in projects:
            meta.project = "general"
        # A workflow must be non-empty and keep the canonical order.
        order = ["planner", "coder", "reviewer"]
        meta.workflow = [a for a in order if a in meta.workflow] or ["planner"]
    d = meta.model_dump()
    d["model"] = settings.model_for_tier(d["model_tier"]) if not llm.is_mock() else "mock"
    d["provider"] = settings.backend_label
    return d


def heuristic(text: str, projects: list[str]) -> TaskMetadata:
    """Keyword-based triage used by the mock provider (and as a shape reference)."""
    t = text.lower()
    project = next((p for p in projects if re.search(rf"\b{re.escape(p.lower())}\b", t)), "general")
    rules: list[tuple[str, TaskType, list[Agent], str]] = [
        (r"\breview\b|\baudit\b", "review", ["reviewer"], "reasoning"),
        (r"\bbug\b|\bfix\b|\berror\b|\bcrash", "bugfix", ["planner", "coder", "reviewer"], "coding"),
        (r"\brefactor|\bclean ?up\b", "refactor", ["planner", "coder", "reviewer"], "coding"),
        (r"\bdocs?\b|\breadme\b|\bdocument", "docs", ["planner", "coder", "reviewer"], "mixed"),
        (r"\bdeploy|\bdocker|\bci\b|\binfra", "ops", ["planner", "coder", "reviewer"], "mixed"),
        (r"\bresearch|\bcompare\b|\binvestigate|\bplan\b|\bdesign\b", "research", ["planner"], "reasoning"),
        (r"\?$|^(what|why|how|which)\b", "question", ["planner"], "reasoning"),
    ]
    task_type, workflow, kind = "feature", ["planner", "coder", "reviewer"], "coding"
    for rx, tt, wf, k in rules:
        if re.search(rx, t.strip()):
            task_type, workflow, kind = tt, wf, k
            break
    words = len(t.split())
    complexity = "low" if words < 12 else "high" if words > 60 else "medium"
    tier = {"low": "fast", "medium": "balanced", "high": "deep"}[complexity]
    return TaskMetadata(
        title=" ".join(text.split()[:8]), project=project, task_type=task_type, workflow=workflow,
        work_kind=kind, complexity=complexity, model_tier=tier, rationale="keyword heuristic (mock provider)",
    )
