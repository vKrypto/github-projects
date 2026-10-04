# AI Team (POC)

A dashboard where you type tasks in plain words. Each task is triaged into metadata, queued, then worked
by a team of agents (planner → senior developer → reviewer) orchestrated with **LangGraph**.

Setup: `cp .env.example .env`, then pick a provider and add its key (`mock` works with no key).
For local dev: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`.

## Deploy (Docker Swarm stack)

```bash
cd ai-team
./deploy.sh          # builds ai-team:latest, `docker swarm init` if needed, deploys stack `ai_team`
```

- Single-node swarm on this workstation. The control plane is bound to `127.0.0.1:2377`.
- Dashboard: `http://<host>:8765` (`AI_TEAM_PORT` to change). Published in host mode, so it's **reachable
  from the LAN with no auth**.
- Config comes from `ai-team/.env` (`env_file`). Edit it, then re-run `./deploy.sh`. Comments must be on
  their own lines; Docker keeps inline `# …` as part of the value.
- Task DB lives on the host at `ai-team/data/tasks.db`.
- Logs: `docker service logs -f ai_team_app` · Remove: `docker stack rm ai_team`.
- Every deploy builds a uniquely tagged image so the service actually rolls. Deploys also regenerate
  `stack.gitmask.yml`, so **re-run after adding a repo** to get its `.git` masked.

**Isolation in the container.** Bubblewrap can't run inside a container under Docker's AppArmor profile,
so the container itself is the sandbox:
- It sees only `~/github` (mounted at `/workspace`). The rest of the host, including `~/.ssh`, is invisible.
- `/workspace/ai-team` is covered by an empty tmpfs.
- Every `.git` dir is covered by an empty tmpfs, and every submodule `.git` file by `/dev/null`.
- The image has no git binary.
- It runs as UID 1000, so files the coder writes stay owned by you.

## Run without Docker (dev)

```bash
.venv/bin/python -m ai_team   # http://127.0.0.1:8765 — stop the stack first, same port
```

## Architecture

```
 Dashboard (dashboard/index.html, vanilla JS, polls every 2.5s)
     │  POST /api/tasks {text}                     GET /api/tasks?status&task_type&project&q
     ▼
 FastAPI (api.py) ──► SQLite (db.py: tasks + events)
     │ background
     ▼
 Triage (triage.py) — one structured-output LLM call
     → title, project, task_type, workflow (agents), work_kind, complexity, model_tier, rationale
     │ status: triaging → queued
     ▼
 Orchestrator (orchestrator.py) — thread; claims queued tasks, runs AI_TEAM_MAX_PARALLEL at once
     │ status: queued → running → done | failed | cancelled
     ▼
 Team graph (graph.py, LangGraph StateGraph)
     START ─► planner ─► coder ─► reviewer ─► END
                            ▲          │ CHANGES_REQUESTED (≤ AI_TEAM_MAX_REVIEW_ROUNDS)
                            └──────────┘
     Nodes are skipped based on triage's `workflow` (e.g. review-only → reviewer; question → planner).
     ▼
 Agents (agents.py) — each a LangChain `create_agent` tool-calling loop with its own role prompt
     planner  (read-only)  explores code, writes plan + acceptance criteria, or answers questions
     coder    (read/write) implements the plan, runs tests, addresses review feedback
     reviewer (read-only)  reads the changed files, ends with VERDICT: APPROVED | CHANGES_REQUESTED
     ▼
 Workspace tools (tools.py) — the agents' only access to the filesystem
     list_dir · read_file · search · write_file · edit_file · run_command
```

| Module | Responsibility |
|---|---|
| `config.py` | Settings from env / `.env` (`AI_TEAM_*`) |
| `db.py` | Task + event persistence (SQLite, `data/tasks.db`) |
| `llm.py` | Model factory (`init_chat_model`), tier → model |
| `triage.py` | Task → metadata (LLM; keyword heuristic under `mock`) |
| `agents.py` | Role definitions + agent runner, streams activity into the event log |
| `graph.py` | LangGraph workflow and routing |
| `orchestrator.py` | Queue worker, status transitions, cancellation, crash recovery |
| `api.py` | REST API + serves the dashboard |

### Model selection
Triage sets `model_tier` (`fast` / `balanced` / `deep`). It maps to `AI_TEAM_MODEL_FAST/BALANCED/DEEP`.
The provider (`anthropic`, `openai`, `ollama`, …) is global, via `AI_TEAM_PROVIDER`.

### Boundaries
- **Filesystem:** Agents only see `AI_TEAM_WORKSPACE_ROOT` (default: the folder containing `ai-team/`).
  Each top-level folder there is a project. Paths outside it, `ai-team/` itself and `.env*` files are denied.
- **No git at all:** There is no git tool, any command mentioning git is refused, and `.git/` folders
  can't be read. The coder's write tools record changed files, and that list is what the reviewer gets.
- **Shell (dev mode):** `run_command` runs under **bubblewrap**. The whole filesystem is read-only except the workspace.
  `ai-team/` and every `.git/` are hidden, and the git binary is masked. Network stays open so agents can
  talk to local services. Without `bwrap` it falls back to a plain shell (only the regex guard applies).

### Known POC limits
- In dev mode `run_command` can still *read* files outside the workspace (e.g. `~/.ssh`); the stack doesn't have this gap.
- The dashboard/API has no auth, and the stack publishes it on the LAN.
- Polling instead of SSE/websockets; a single process holds the API, triage and orchestrator.
- No per-task checkpointing: a task interrupted by a restart re-runs from the start.
- Cancelling a running task takes effect at the next agent step, not instantly.

## Next steps (toward the full "company")
More roles (QA/tester, DevOps, security reviewer) as new graph nodes. A supervisor node that routes
dynamically instead of a fixed workflow. LangGraph checkpointer (SQLite) for resume and human-in-the-loop
approval. Parallel tasks with per-project locking. Per-role model overrides. SSE live log.
