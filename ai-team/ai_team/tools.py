"""Workspace tools handed to agents. This is the agents' only route to the filesystem.

Every path is resolved and must stay inside settings.workspace_root. ai-team/ itself,
.env files and .git internals are off-limits. Agents never touch git in any way.
Shell commands run under bubblewrap (bwrap): the whole filesystem is read-only except the
workspace, ai-team/ and every .git folder are hidden, and the git binary is masked.
"""
import fnmatch
import functools
import os
import re
import shutil
import subprocess
from pathlib import Path

from langchain_core.tools import BaseTool, tool

from .config import APP_DIR, settings

SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", ".cache"}
MAX_READ = 60_000
BLOCKED_CMD = re.compile(
    r"\bgit\b|\bsudo\b|\brm\s+-[a-z]*r[a-z]*f?\s+/(\s|$)"
    r"|\bcurl\b.*\|\s*(ba)?sh|\bshutdown\b|\breboot\b|\bmkfs\b|\bdd\s+if="
)


class SandboxError(Exception):
    pass


def is_hidden(p: Path) -> bool:
    p = p.resolve()
    return any(p == h or h in p.parents for h in settings.hidden_dirs)


def list_projects() -> list[str]:
    root = settings.workspace_root
    return sorted(
        p.name for p in root.iterdir()
        if p.is_dir() and not p.name.startswith(".") and not is_hidden(p) and p.name not in SKIP_DIRS
    )


def resolve(path: str, write: bool = False) -> Path:
    root = settings.workspace_root
    p = (root / path).resolve() if not os.path.isabs(path) else Path(path).resolve()
    if p != root and root not in p.parents:
        raise SandboxError(f"{path!r} is outside the workspace")
    if is_hidden(p):
        raise SandboxError("the ai-team folder is off-limits")
    if p.name.startswith(".env") and p.name != ".env.example":
        raise SandboxError("secret files (.env*) are off-limits")
    if ".git" in p.relative_to(root).parts:
        raise SandboxError("git is off-limits")
    return p


def rel(p: Path) -> str:
    return str(p.relative_to(settings.workspace_root)) or "."


def sandboxed(command: str, cwd: Path) -> list[str]:
    """Wrap a shell command in bwrap; falls back to a plain shell if bwrap is missing."""
    bwrap = shutil.which("bwrap")
    if not bwrap:
        return ["sh", "-c", command]
    root = str(settings.workspace_root)
    argv = [bwrap, "--ro-bind", "/", "/", "--bind", root, root, "--dev", "/dev", "--proc", "/proc",
            "--tmpfs", "/tmp", "--die-with-parent"]
    hidden = [*settings.hidden_dirs, settings.workspace_root / ".git", *settings.workspace_root.glob("*/.git")]
    for h in hidden:
        if h.is_dir():
            argv += ["--tmpfs", str(h)]
    git = shutil.which("git")
    if git:
        argv += ["--ro-bind", "/dev/null", os.path.realpath(git)]
    return argv + ["--chdir", str(cwd), "sh", "-c", command]


def make_tools(read_only: bool, log=lambda kind, msg: None, changed: set | None = None) -> list[BaseTool]:
    """Build the tool set for one agent run. `log(kind, msg)` records tool activity on the task;
    files written by the agent are added to `changed` so the reviewer knows what to look at."""
    changed = changed if changed is not None else set()

    def guarded(fn):
        @functools.wraps(fn)
        def wrapper(*a, **kw):
            args = [repr(v)[:80] for v in a] + [f"{k}={str(v)[:80]!r}" for k, v in kw.items()]
            log("tool", f"{fn.__name__}({', '.join(args)})")
            try:
                return fn(*a, **kw)
            except SandboxError as e:
                return f"DENIED: {e}"
            except Exception as e:  # tools report errors to the model rather than crash the run
                return f"ERROR: {type(e).__name__}: {e}"
        return wrapper

    @tool
    @guarded
    def list_dir(path: str = ".", depth: int = 2) -> str:
        """List files and folders under `path` (relative to the workspace root), up to `depth` levels."""
        base = resolve(path)
        out = []
        for dirpath, dirnames, filenames in os.walk(base):
            d = Path(dirpath)
            level = len(d.relative_to(base).parts)
            dirnames[:] = sorted(n for n in dirnames if n not in SKIP_DIRS and not is_hidden(d / n))
            if level >= depth:
                dirnames[:] = []
            for n in dirnames:
                out.append(rel(d / n) + "/")
            out.extend(rel(d / f) for f in sorted(filenames) if not f.startswith(".env"))
            if len(out) > 500:
                out.append("... (truncated)")
                break
        return "\n".join(out) or "(empty)"

    @tool
    @guarded
    def read_file(path: str, start_line: int = 1, max_lines: int = 400) -> str:
        """Read a text file (relative to the workspace root). Returns numbered lines."""
        lines = resolve(path).read_text(errors="replace").splitlines()
        chunk = lines[start_line - 1:start_line - 1 + max_lines]
        text = "\n".join(f"{i}\t{l}" for i, l in enumerate(chunk, start_line))
        more = f"\n... ({len(lines)} lines total)" if start_line - 1 + max_lines < len(lines) else ""
        return text[:MAX_READ] + more

    @tool
    @guarded
    def search(pattern: str, path: str = ".", glob: str = "*") -> str:
        """Regex-search file contents under `path`; `glob` filters file names (e.g. '*.py')."""
        base, rx, hits = resolve(path), re.compile(pattern), []
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [n for n in dirnames if n not in SKIP_DIRS and not is_hidden(Path(dirpath) / n)]
            for f in filenames:
                if not fnmatch.fnmatch(f, glob) or f.startswith(".env"):
                    continue
                fp = Path(dirpath) / f
                try:
                    for i, line in enumerate(fp.read_text(errors="ignore").splitlines(), 1):
                        if rx.search(line):
                            hits.append(f"{rel(fp)}:{i}: {line.strip()[:200]}")
                except OSError:
                    continue
                if len(hits) >= 200:
                    return "\n".join(hits) + "\n... (truncated)"
        return "\n".join(hits) or "no matches"

    tools = [list_dir, read_file, search]
    if read_only:
        return tools

    @tool
    @guarded
    def write_file(path: str, content: str) -> str:
        """Create or overwrite a file (relative to the workspace root) with `content`."""
        p = resolve(path, write=True)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        changed.add(rel(p))
        return f"wrote {rel(p)} ({len(content)} chars)"

    @tool
    @guarded
    def edit_file(path: str, old: str, new: str) -> str:
        """Replace the single exact occurrence of `old` with `new` in a file."""
        p = resolve(path, write=True)
        text = p.read_text()
        n = text.count(old)
        if n != 1:
            return f"ERROR: `old` found {n} times; it must match exactly once"
        p.write_text(text.replace(old, new, 1))
        changed.add(rel(p))
        return f"edited {rel(p)}"

    @tool
    @guarded
    def run_command(command: str, cwd: str = ".") -> str:
        """Run a shell command (tests, linters, builds) with `cwd` inside the workspace.
        Only the workspace is writable; git is not available."""
        if BLOCKED_CMD.search(command):
            raise SandboxError("command not allowed (no git, sudo or destructive ops)")
        workdir = resolve(cwd)
        r = subprocess.run(sandboxed(command, workdir), cwd=workdir, capture_output=True, text=True,
                           timeout=settings.command_timeout)
        out = (r.stdout + ("\n[stderr]\n" + r.stderr if r.stderr else ""))[-12_000:]
        return f"exit={r.returncode}\n{out}"

    return tools + [write_file, edit_file, run_command]
