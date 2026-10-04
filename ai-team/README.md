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
- **Every deploy is verified** before the script reports success:
  - the new container is running, with no swarm rollback
  - the Docker healthcheck reports healthy
  - API and dashboard answer on the port, with the expected backend and the workspace mounted
  - isolation holds (no git, `.git` masked, `ai-team/` hidden)
  - the backend has its credentials or gateway

  On any failure it prints the service tasks and the last logs, then exits 1. A version that doesn't
  start is rolled back by swarm automatically (`update_config.failure_action: rollback`).
  `DEPLOY_TIMEOUT` (default 180s) bounds the wait.
- Logs: `docker service logs -f ai_team_app` · Remove: `docker stack rm ai_team`.
- Every deploy builds a uniquely tagged image so the service actually rolls. Deploys also regenerate
  `stack.generated.yml`, so **re-run after adding a repo** to get its `.git` masked.

**Isolation in the container.** Bubblewrap can't run inside a container under Docker's AppArmor profile,
so the container itself is the sandbox:
- It sees only `~/github` (mounted at `/workspace`). The rest of the host, including `~/.ssh`, is invisible.
- `/workspace/ai-team` is covered by an empty tmpfs.
- Every `.git` dir is covered by an empty tmpfs, and every submodule `.git` file by `/dev/null`.
- The image has no git binary.
- It runs as UID 1000, so files the coder writes stay owned by you.

### Agent backends

`AI_TEAM_AGENT_BACKEND` in `.env` picks who runs the agents. The CLI backends use **subscriptions,
not pay-as-you-go API keys**.

| Backend | Who runs each role | Auth (`./deploy.sh` does the login) | Where the credential lives |
|---|---|---|---|
| `claude` | Claude Code headless (`claude -p`) | `claude setup-token` (browser), ~1-year inference-only token | `ai-team/data/claude/oauth_token` (mode 600, gitignored) → swarm secret → `/run/secrets/claude_oauth_token` |
| `codex` | Codex CLI headless (`codex exec --json`) | `codex login --device-auth` (ChatGPT plan), run inside the image | `ai-team/data/codex/` (mode 700, gitignored), mounted at `/data/codex` |
| `langchain` | LangChain `create_agent` + `tools.py` | `AI_TEAM_PROVIDER` / base URL | `.env` |

- **Checked before every deploy:** the stored credential is tested with one tiny real call ("Reply with
  exactly: OK") from a throwaway container of the new image. If it's missing or rejected, e.g.
  `401 OAuth access token is invalid`, the script logs in again, updates the file and re-checks. Login
  needs an interactive terminal; non-interactive runs stop with a clear error before touching the stack.
- **Rotate on demand:** `./deploy.sh --relogin`.
- **The Claude swarm secret is named after the token's hash**, so it's recreated only when the token changes.
- **Non-interactive seeding:** `CLAUDE_CODE_OAUTH_TOKEN=… ./deploy.sh` saves the given token to the file.
- **Both CLIs log in separately from the host CLIs.** Copying the host's stored login would break: Claude's
  access token expires within hours, and both CLIs rotate refresh tokens, so host and container would log
  each other out.
- **Codex's credentials can't be a swarm secret.** Swarm secrets are read-only, but Codex rewrites its
  tokens when it refreshes them.

**Role limits:**
- **Claude:**
  - planner and reviewer: `Read,Grep,Glob`
  - coder: adds `Edit,Write,Bash`
  - always denied: `git`, web tools, reading `/run/secrets`
  - models per tier: `AI_TEAM_CLI_MODEL_*`
- **Codex:**
  - Its own sandbox needs bubblewrap, which Docker's AppArmor blocks, so it runs with `--dangerously-bypass-approvals-and-sandbox` and the container is the sandbox.
  - It can't be limited to read-only tools. Planner and reviewer are told they're read-only, and **a step fails if they change any file**.
  - Tiers set reasoning effort `low`/`medium`/`high`. `AI_TEAM_CODEX_MODEL_*` empty means your plan's default model.

**Shared caveat:** agents run as the same user that can read their credentials (the Claude token file, or
`/data/codex/auth.json`, plus the task DB in `/data`). A shell command could print them. Treat credentials
as exposed to whatever the agents read, and re-login if a repo looks hostile.

## Run without Docker (dev)

```bash
.venv/bin/python -m ai_team   # http://127.0.0.1:8765 — stop the stack first, same port
```

## Architecture

### System overview

Everything runs in one container on a single-node Docker Swarm. The only host folder it can write to is
the root working dir (`~/github`), mounted at `/workspace`.

```mermaid
flowchart LR
    user(["You (browser)"])

    subgraph host["Workstation · single-node Docker Swarm"]
        direction LR
        subgraph ctr["ai_team_app container (UID 1000, no git binary)"]
            direction TB
            dash["Dashboard<br/>dashboard/index.html"]
            api["FastAPI<br/>api.py"]
            db[("SQLite<br/>tasks + events")]
            triage["Triage<br/>triage.py"]
            orch["Orchestrator<br/>orchestrator.py"]
            tgraph["Team graph<br/>graph.py · LangGraph"]
            agents["Role runner<br/>agents.py"]

            subgraph backends["Agent backend · AI_TEAM_AGENT_BACKEND"]
                direction TB
                claude["claude<br/>Claude Code: claude -p"]
                codex["codex<br/>Codex CLI: codex exec --json"]
                lc["langchain<br/>create_agent + tools.py"]
            end
        end

        ws[("/workspace = ~/github<br/>repos: read/write<br/>ai-team/ and .git hidden")]
        data[("ai-team/data<br/>tasks.db · codex login")]
        secret[["Swarm secret<br/>Claude token"]]
    end

    anthropic(["Anthropic<br/>Claude subscription"])
    openai(["OpenAI<br/>ChatGPT plan"])
    omni(["OmniRoute gateway<br/>192.168.100.10:10200"])

    user -->|":8765"| dash
    dash -->|"REST, polls every 2.5s"| api
    api --> db
    api -->|"new task"| triage
    triage -->|"metadata, status queued"| db
    orch -->|"claim next queued"| db
    orch --> tgraph --> agents
    agents --> claude & codex & lc
    claude --> ws
    codex --> ws
    lc --> ws
    agents -->|"activity log"| db
    claude -.-> anthropic
    codex -.-> openai
    lc -.-> omni
    secret -.->|"/run/secrets"| claude
    data -.->|"/data"| db
    data -.->|"/data/codex"| codex
```

### Task lifecycle

```mermaid
stateDiagram-v2
    [*] --> triaging: POST /api/tasks
    triaging --> queued: triage sets project, type, agents, tier
    triaging --> failed: triage error
    queued --> running: orchestrator claims it, up to AI_TEAM_MAX_PARALLEL at once
    running --> done: workflow finished, reviewer approved if there was code
    running --> failed: agent error, or not approved after max review rounds
    triaging --> cancelled: Cancel
    queued --> cancelled: Cancel
    running --> cancelled: Cancel, takes effect at the next agent event
    done --> triaging: Retry, which re-triages
    failed --> triaging: Retry
    cancelled --> triaging: Retry
```

### Team graph (LangGraph)

Triage picks the `workflow`, and routing skips the agents a task doesn't need. A review-only task goes
straight to the reviewer, and a question goes only to the planner.

```mermaid
flowchart LR
    S((START)) --> E{"first agent<br/>in workflow"}
    E -->|planner| P["Planner<br/>read-only<br/>plan + acceptance criteria,<br/>or answers the question"]
    E -->|coder| C
    E -->|reviewer| R
    P --> AP{"coder in<br/>workflow?"}
    AP -->|yes| C["Developer<br/>read/write<br/>implements, runs tests,<br/>records changed files"]
    AP -->|"no, reviewer is"| R
    AP -->|neither| X((END))
    C --> AC{"reviewer in<br/>workflow?"}
    AC -->|yes| R["Reviewer<br/>read-only<br/>reads changed files,<br/>gives a VERDICT"]
    AC -->|no| X
    R --> V{"APPROVED?"}
    V -->|yes| X
    V -->|"CHANGES_REQUESTED<br/>and rounds below max"| C
    V -->|"rounds used up"| X
```

### One agent step

The model never touches the disk. It asks for a tool, and the tool runs inside the container. Whatever a
tool reads is sent to the provider as text.

```mermaid
sequenceDiagram
    autonumber
    participant G as Team graph
    participant R as Role runner
    participant B as CLI or LangChain loop
    participant M as LLM provider
    participant W as /workspace

    G->>R: run role with brief (task, plan, review feedback)
    R->>B: start with role prompt, allowed tools, project dir
    loop until the model gives a final answer
        B->>M: conversation so far + tool definitions
        M-->>B: tool call, e.g. Read app/main.py
        B->>W: run tool (git denied, .git and ai-team hidden)
        W-->>B: result
        B-->>R: stream event (message, tool call, file change)
        R->>R: append to activity log, check for Cancel
    end
    M-->>B: final answer
    B-->>R: result + changed files
    R-->>G: plan, summary or VERDICT
```

### Deploy flow (`./deploy.sh`)

```mermaid
flowchart TD
    A["./deploy.sh [--relogin]"] --> B["read .env<br/>root working dir, backend"]
    B --> C{"swarm active?"}
    C -->|yes| F["docker build<br/>unique image tag"]
    C -->|no| C1["docker swarm init<br/>bound to 127.0.0.1"] --> F
    F --> G{"backend"}
    G -->|"claude or codex"| K{"stored credential works?<br/>one tiny real call"}
    K -->|"no, or --relogin"| L["log in again<br/>claude setup-token, or<br/>codex login --device-auth<br/>update data/claude or data/codex"] --> K
    K -->|yes| M["claude only: swarm secret<br/>named by token hash"] --> H
    G -->|langchain| H["generate stack.generated.yml<br/>tmpfs over every .git<br/>/dev/null over submodule .git files<br/>attach token secret"]
    H --> I["docker stack deploy ai_team<br/>stack.yml + stack.generated.yml"]
    I --> V1{"new container running?<br/>no swarm rollback"}
    V1 -->|yes| V2{"healthcheck<br/>healthy?"}
    V2 -->|yes| V3{"API + dashboard on :8765<br/>expected backend,<br/>workspace mounted?"}
    V3 -->|yes| V4{"isolation: no git,<br/>.git masked,<br/>ai-team hidden?"}
    V4 -->|yes| V5{"backend credentials<br/>reached the container?"}
    V5 -->|yes| J["prune old token secrets<br/>✓ deployed and verified"]
    V1 -->|no| X["✗ print tasks + logs<br/>exit 1"]
    V2 -->|no| X
    V3 -->|no| X
    V4 -->|no| X
    V5 -->|no| X
```

| Module | Responsibility |
|---|---|
| `config.py` | Settings from env / `.env` (`AI_TEAM_*`) |
| `db.py` | Task + event persistence (SQLite, `data/tasks.db`) |
| `llm.py` | Model factory (`init_chat_model`), tier → model |
| `triage.py` | Task → metadata (LLM; keyword heuristic under `mock`) |
| `agents.py` | Role definitions + role runner; dispatches to the configured backend, streams activity into the event log |
| `cli_agent.py` | Claude Code backend (`claude -p`, per-role tool limits, token from the swarm secret) |
| `codex_cli.py` | Codex CLI backend (`codex exec --json`, ChatGPT login state, read-only guard) |
| `tools.py` | Sandboxed workspace tools for the `langchain` backend |
| `graph.py` | LangGraph workflow and routing |
| `orchestrator.py` | Queue worker, status transitions, cancellation, crash recovery; runs each turn on the task's checkpointed thread |
| `memory.py` | LangGraph SQLite checkpointer (`data/checkpoints.db`): team-graph state and agent threads per task |
| `api.py` | REST API + serves the dashboard |

### Continue chat (follow-ups)

A task is a conversation. Once it's done, failed or cancelled, the dashboard's **Continue this task** box
(or `POST /api/tasks/{id}/messages {"text": …}`) queues another turn on the same task, like resuming a
`claude` CLI session. The same team picks it up with its memory:

```mermaid
flowchart LR
    U["follow-up text"] --> Q["turn N+1 queued<br/>messages table"]
    Q --> O["orchestrator<br/>graph.invoke on thread = task id"]
    O <-->|"restore / save"| CP[("data/checkpoints.db<br/>LangGraph SqliteSaver")]
    O --> A["each agent resumes its own session"]
    A --> C1["claude: --resume &lt;session-id&gt;<br/>transcripts in data/claude-home"]
    A --> C2["codex: exec resume &lt;thread-id&gt;<br/>transcripts in data/codex"]
    A --> C3["langchain: checkpointer thread<br/>&lt;task&gt;:&lt;role&gt;"]
    O --> R["outcome appended to the<br/>conversation as turn N+1"]
```

- **What carries over** in the graph checkpoint (thread = task id): plan, result, review, and each agent's
  session id. **Reset each turn:** review rounds, approval and the changed-files list.
- **Every follow-up brief** has the original task, a compact history of earlier turns and the new request.
  An agent that has no session yet (e.g. tasks from before this feature) still has the full context.
- **The follow-up reuses the task's triage** (project, agents, tier); it isn't re-triaged.
- **Retry** re-runs only the latest turn. Retrying turn 1 starts over: re-triage, and all memory for the
  task is forgotten.
- **Storage:** everything is local in `ai-team/data/` (SQLite + CLI transcript folders, gitignored).
  Redis could replace the SQLite checkpointer later (`langgraph-checkpoint-redis`), e.g. for several
  orchestrator replicas.

### Re-verify (is it actually done?)

**Verify** on a finished task, or `POST /api/tasks/{id}/verify`, queues an independent check of the
**current code** against **every request in the task's conversation**:

- **A separate `verifier` agent**, started fresh each time (no shared session, so it doesn't inherit the team's
  assumptions). It gets all user requests, the files changed across all turns, and the developer's last
  summary as *claims to check*.
- **It reads code and runs tests/builds but must not edit:**
  - claude: `Read,Grep,Glob,Bash`, with git denied
  - codex: the step fails if it edits files
  - langchain: read tools + `run_command`
- **The report:** a checklist (`[x]` met / `[~]` partly / `[ ]` not met) with evidence, the gaps as concrete
  fixes, and a final `VERIFICATION: DONE | PARTIAL | NOT_DONE`.
- **The verdict is stored next to the task** (`verify_state`, `verification`, `verified_at`), shown as a badge,
  and added to the conversation. It **never changes the task's status**.
- **On PARTIAL or NOT_DONE,** **Continue with gaps** prefills a follow-up asking the team to fix them. The
  verifier's report is part of the conversation history the team sees.
- **It runs through the orchestrator queue** (counts against `AI_TEAM_MAX_PARALLEL`), never while the task
  itself is running. A new turn or retry clears the earlier verdict as stale.

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
- A task interrupted by a restart re-runs its current turn from the start (earlier turns are kept).
- Cancelling a running task takes effect at the next agent step, not instantly.

## Next steps (toward the full "company")
More roles (QA/tester, DevOps, security reviewer) as new graph nodes. A supervisor node that routes
dynamically instead of a fixed workflow. LangGraph checkpointer (SQLite) for resume and human-in-the-loop
approval. Parallel tasks with per-project locking. Per-role model overrides. SSE live log.
