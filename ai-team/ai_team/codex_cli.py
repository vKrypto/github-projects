"""Agent backend that runs each role through the OpenAI Codex CLI in headless mode (`codex exec --json`).

Auth is your ChatGPT subscription: `./deploy.sh` runs `codex login --device-auth` inside the image and
keeps the resulting state in ai-team/data/codex (mounted as CODEX_HOME). It is a separate login from
any Codex on the host, so the two never rotate each other's refresh tokens.

Codex's own sandbox needs bubblewrap, which Docker's AppArmor profile blocks, so Codex runs with its
sandbox bypassed and the container is the sandbox (only /workspace mounted, .git hidden, no git binary).
Codex can't be limited to read-only tools, so read-only roles are checked afterwards: any file change
they make fails the step.
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path

from .config import settings

EFFORT = {"fast": "low", "balanced": "medium", "deep": "high"}
READ_ONLY_ROLES = {"planner", "reviewer"}


class CliError(Exception):
    pass


def model_label(tier: str) -> str:
    model = settings.codex_model_for_tier(tier) or "default"
    return f"{model} · {EFFORT.get(tier, 'medium')} effort"


def _base_cmd(tier: str, model: str | None, cwd: Path) -> list[str]:
    cmd = [settings.codex_bin, "exec", "--json", "--ephemeral", "--skip-git-repo-check",
           "--dangerously-bypass-approvals-and-sandbox",  # container is the sandbox (see module doc)
           "-C", str(cwd), "-c", f'model_reasoning_effort="{EFFORT.get(tier, "medium")}"']
    if model:
        cmd += ["-m", model]
    return cmd


def _env() -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith("AI_TEAM_")}
    env["CODEX_HOME"] = str(settings.codex_home)
    return env


def _check_logged_in() -> None:
    if not (settings.codex_home / "auth.json").is_file():
        raise CliError("Codex is not logged in: run ./deploy.sh (it runs `codex login --device-auth`)")


def _rel(path: str, cwd: Path) -> str | None:
    try:
        return str((cwd / path).resolve().relative_to(settings.workspace_root))
    except ValueError:
        return None


def project_dir(project: str | None) -> Path:
    p = settings.workspace_root / (project or "")
    return p if project and project != "general" and p.is_dir() else settings.workspace_root


def _stream(cmd: list[str], prompt: str, cwd: Path, log, cancelled, on_item=None) -> str:
    """Run codex exec, feed `prompt` on stdin, log its JSONL events, return the final message."""
    _check_logged_in()
    with tempfile.NamedTemporaryFile("r", suffix=".txt") as last:
        proc = subprocess.Popen(cmd + ["-o", last.name, "-"], cwd=cwd, env=_env(), stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        proc.stdin.write(prompt)
        proc.stdin.close()
        error, usage = None, None
        try:
            for line in proc.stdout:
                if cancelled():
                    proc.kill()
                    raise InterruptedError()
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                kind = ev.get("type", "")
                if kind == "item.completed":
                    item = ev.get("item") or {}
                    t = item.get("type")
                    if t == "agent_message" and item.get("text"):
                        log("message", item["text"])
                    elif t == "command_execution":
                        log("tool", f"shell({item.get('command', '')[:160]!r}) → exit {item.get('exit_code')}")
                    elif t == "file_change":
                        log("tool", "edit(" + ", ".join(f"{c.get('kind')} {c.get('path')}"
                                                         for c in item.get("changes", [])) + ")")
                    elif t in ("mcp_tool_call", "web_search"):
                        log("tool", f"{t}({str(item)[:160]})")
                    if on_item:
                        on_item(item)
                elif kind == "turn.completed":
                    usage = ev.get("usage")
                elif kind in ("turn.failed", "error"):
                    error = (ev.get("error") or {}).get("message") or ev.get("message") or str(ev)
            proc.wait(timeout=60)
        finally:
            if proc.poll() is None:
                proc.kill()
        final = Path(last.name).read_text().strip()
    if error or (proc.returncode and not final):
        raise CliError(f"codex failed (exit {proc.returncode}): {error or proc.stderr.read()[-2000:]}")
    if usage:
        log("status", f"tokens in {usage.get('input_tokens', '?')} (cached {usage.get('cached_input_tokens', 0)}),"
                      f" out {usage.get('output_tokens', '?')}")
    return final


def run(role: str, system_prompt: str, brief: str, tier: str, project: str | None,
        log, changed: set, cancelled) -> str:
    cwd = project_dir(project)
    touched: list[str] = []

    def on_item(item):
        if item.get("type") == "file_change":
            for c in item.get("changes", []):
                if (r := _rel(c.get("path", ""), cwd)) is not None:
                    touched.append(r)

    prompt = f"{system_prompt}\n\n---\n\n{brief}"
    if role in READ_ONLY_ROLES:
        prompt = "You are in READ-ONLY mode: do not create, modify or delete any file.\n\n" + prompt
    out = _stream(_base_cmd(tier, settings.codex_model_for_tier(tier), cwd), prompt, cwd, log, cancelled, on_item)
    if role in READ_ONLY_ROLES and touched:
        raise CliError(f"read-only {role} modified files: {', '.join(sorted(set(touched)))}")
    changed.update(touched)
    return out


def _strict(schema: dict) -> dict:
    """OpenAI structured output wants every object closed and every property required."""
    if schema.get("type") == "object":
        schema["additionalProperties"] = False
        schema["required"] = list(schema.get("properties", {}))
    for v in list(schema.get("properties", {}).values()) + list(schema.get("$defs", {}).values()):
        _strict(v)
    if isinstance(schema.get("items"), dict):
        _strict(schema["items"])
    return schema


def structured(prompt: str, schema: dict, tier: str = "fast") -> dict:
    """One call whose final answer is JSON matching `schema` (used for triage)."""
    with tempfile.NamedTemporaryFile("w", suffix=".json") as f:
        json.dump(_strict(schema), f)
        f.flush()
        cmd = _base_cmd(tier, settings.codex_model_triage or None, settings.workspace_root)
        cmd += ["--output-schema", f.name]
        text = _stream(cmd, "Answer with JSON only. Do not run any commands.\n\n" + prompt,
                       settings.workspace_root, lambda *_: None, lambda: False)
    return json.loads(text[text.find("{"):text.rfind("}") + 1])
