"""Agent backend that runs each role through the Claude Code CLI in headless mode (`claude -p`).

The CLI brings its own agent loop and file tools; we restrict which tools each role gets, deny git,
and stream its JSON events into the task's activity log. Auth: a long-lived OAuth token
(`claude setup-token`), delivered as a swarm secret file and passed only to the CLI process.
"""
import json
import os
import subprocess
import uuid
from pathlib import Path

from .config import settings

ROLE_TOOLS = {
    "planner": "Read,Grep,Glob",
    "reviewer": "Read,Grep,Glob",
    "coder": "Read,Grep,Glob,Edit,Write,Bash",
    "verifier": "Read,Grep,Glob,Bash",  # runs tests; told not to modify files
}
# Deny rules apply even under bypassPermissions. `//` = absolute path in Claude Code rules.
DENY = ["Bash(git:*)", "Bash(git *)", "WebFetch", "WebSearch", "Read(//run/secrets/**)"]
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}


class CliError(Exception):
    pass


def token() -> str:
    tok = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", "")
    if not tok and settings.claude_token_file.is_file():
        tok = settings.claude_token_file.read_text().strip()
    if not tok:
        raise CliError(f"no Claude token: set CLAUDE_CODE_OAUTH_TOKEN or provide {settings.claude_token_file}")
    return tok


def _env() -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith("AI_TEAM_")}
    env["CLAUDE_CODE_OAUTH_TOKEN"] = token()
    env["DISABLE_AUTOUPDATER"] = "1"
    env["CLAUDE_CONFIG_DIR"] = str(settings.claude_config_dir)  # persistent, so sessions can be resumed
    return env


def _base_cmd(model: str) -> list[str]:
    return [settings.claude_bin, "-p", "--model", model, "--strict-mcp-config"]


def project_dir(project: str | None) -> Path:
    p = settings.workspace_root / (project or "")
    return p if project and project != "general" and p.is_dir() else settings.workspace_root


def _summarize(name: str, inp: dict) -> str:
    key = inp.get("file_path") or inp.get("pattern") or inp.get("command") or inp.get("path") or ""
    return f"{name}({str(key)[:160]!r})"


def _rel(path: str) -> str | None:
    try:
        return str(Path(path).resolve().relative_to(settings.workspace_root))
    except ValueError:
        return None


def run(role: str, system_prompt: str, brief: str, model: str, project: str | None,
        log, changed: set, cancelled, session: str | None = None) -> tuple[str, str]:
    """Run one role to completion; returns (answer, session id). Passing the previous session id
    resumes that conversation (follow-ups). `log(kind, msg)` records activity; `cancelled()` aborts."""
    session_args = ["--resume", session] if session else ["--session-id", str(uuid.uuid4())]
    if session:
        log("status", f"resuming session {session[:8]}")
    cmd = _base_cmd(model) + session_args + [
        "--output-format", "stream-json", "--verbose",
        "--tools", ROLE_TOOLS[role],
        "--disallowedTools", *DENY,
        "--permission-mode", "bypassPermissions",  # the container is the sandbox; deny rules still apply
        "--append-system-prompt", system_prompt,
        "--add-dir", str(settings.workspace_root),  # may read sibling projects; still only /workspace
    ]
    if settings.cli_max_budget_usd:
        cmd += ["--max-budget-usd", str(settings.cli_max_budget_usd)]
    proc = subprocess.Popen(cmd, cwd=project_dir(project), env=_env(), stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    proc.stdin.write(brief)  # prompt via stdin: no argv length limit
    proc.stdin.close()
    final, result = "", None
    try:
        for line in proc.stdout:
            if cancelled():
                proc.kill()
                raise InterruptedError()
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if ev.get("type") == "assistant":
                for block in ev.get("message", {}).get("content", []):
                    if block.get("type") == "text" and block.get("text", "").strip():
                        final = block["text"]
                        log("message", final)
                    elif block.get("type") == "tool_use":
                        inp = block.get("input") or {}
                        log("tool", _summarize(block.get("name", "?"), inp))
                        if block.get("name") in EDIT_TOOLS and inp.get("file_path"):
                            if (r := _rel(inp["file_path"])) is not None:
                                changed.add(r)
            elif ev.get("type") == "result":
                result = ev
        proc.wait(timeout=60)
    finally:
        if proc.poll() is None:
            proc.kill()
    if result is None:
        raise CliError(f"claude exited {proc.returncode} without a result: {proc.stderr.read()[-2000:]}")
    if result.get("is_error"):
        raise CliError(f"claude {result.get('subtype', 'error')}: {str(result.get('result', ''))[:1000]}")
    cost = result.get("total_cost_usd")
    log("status", f"finished in {result.get('num_turns', '?')} turns"
                  + (f", ~${cost:.3f} (API-equivalent)" if cost is not None else ""))
    return result.get("result") or final, result.get("session_id") or session_args[1]


def structured(prompt: str, schema: dict, model: str) -> dict:
    """One tool-less call returning JSON that matches `schema` (used for triage)."""
    cmd = _base_cmd(model) + ["--no-session-persistence", "--output-format", "json", "--tools", "",
                              "--json-schema", json.dumps(schema)]
    r = subprocess.run(cmd, input=prompt, cwd=settings.workspace_root, env=_env(), capture_output=True,
                       text=True, timeout=300)
    try:
        out = json.loads(r.stdout)
    except json.JSONDecodeError:
        raise CliError(f"claude exited {r.returncode}: {(r.stderr or r.stdout)[-2000:]}")
    if out.get("is_error"):
        raise CliError(f"claude {out.get('subtype', 'error')}: {str(out.get('result', ''))[:1000]}")
    data = out.get("structured_output")
    if data is None:  # fall back to JSON in the text answer
        text = out.get("result", "")
        data = json.loads(text[text.find("{"):text.rfind("}") + 1])
    return data
