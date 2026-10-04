#!/usr/bin/env bash
# Build the image and (re)deploy the ai_team swarm stack on this machine.
#   ./deploy.sh            deploy (logs in first if the claude/codex backend has no credentials yet)
#   ./deploy.sh --relogin  log in again (new Claude token / new Codex device login), then deploy
#   ./deploy.sh --smoke    also make one tiny real LLM call through the backend after deploying
# Every deploy is verified (rollout, healthcheck, HTTP, isolation, backend credentials); the script
# exits non-zero with diagnostics if any check fails. DEPLOY_TIMEOUT (default 180s) bounds the wait.
set -euo pipefail
cd "$(dirname "$0")"

STACK=ai_team
SERVICE="${STACK}_app"
SECRET_PREFIX=ai_team_claude_token_
RELOGIN=false
SMOKE=false
for arg in "$@"; do
  case "$arg" in
    --relogin) RELOGIN=true ;;
    --smoke) SMOKE=true ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

[ -f .env ] || { cp .env.example .env; echo "created .env from .env.example (provider=mock)"; }
env_get() { sed -n "s/^$1=//p" .env | tail -1; }
# Root working dir = the only host folder mounted writable into the container.
WORKSPACE_HOST_DIR="$(env_get AI_TEAM_WORKSPACE_ROOT)"
export WORKSPACE_HOST_DIR="$(realpath "${WORKSPACE_HOST_DIR:-..}")"
export DATA_HOST_DIR="$PWD/data"
export AI_TEAM_PORT="${AI_TEAM_PORT:-8765}"
BACKEND="$(env_get AI_TEAM_AGENT_BACKEND)"
mkdir -p "$DATA_HOST_DIR"

if [ "$(docker info --format '{{.Swarm.LocalNodeState}}')" != "active" ]; then
  echo "initialising single-node swarm"
  # Control plane bound to loopback: this single-node swarm is not meant to be joined.
  docker swarm init --advertise-addr 127.0.0.1 --listen-addr 127.0.0.1:2377 >/dev/null
fi

[ "$BACKEND" = "cli" ] && BACKEND=claude   # old name

# --- Claude login → swarm secret (claude backend only) -------------------------------------------
# The token from `claude setup-token` is a long-lived, inference-only OAuth token for your Claude
# subscription. It is stored as an (encrypted) swarm secret, never in .env or the image. Secrets
# are immutable, so each login creates a new timestamped one and older ones are pruned.
find_claude() {
  command -v claude 2>/dev/null && return
  ls -1d "$HOME"/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | sort -V | tail -1
}
SECRET=""
if [ "$BACKEND" = "claude" ]; then
  SECRET="$(docker secret ls --format '{{.Name}}' | grep "^$SECRET_PREFIX" | sort | tail -1 || true)"
  if [ -z "$SECRET" ] || $RELOGIN; then
    TOKEN="${CLAUDE_CODE_OAUTH_TOKEN:-}"
    if [ -z "$TOKEN" ]; then
      [ -t 0 ] || { echo "Claude login needs an interactive terminal (or export CLAUDE_CODE_OAUTH_TOKEN)." >&2; exit 1; }
      CLAUDE="$(find_claude)"
      [ -n "$CLAUDE" ] || { echo "claude CLI not found; install it or export CLAUDE_CODE_OAUTH_TOKEN." >&2; exit 1; }
      echo "== Claude login: a browser window opens; approve, then copy the token it prints. =="
      "$CLAUDE" setup-token
      read -rsp "Paste the token (input hidden): " TOKEN; echo
    fi
    TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
    [[ "$TOKEN" == sk-ant-* ]] || { echo "that doesn't look like a Claude token (expected sk-ant-…)" >&2; exit 1; }
    SECRET="$SECRET_PREFIX$(date +%Y%m%d%H%M%S)"
    printf '%s' "$TOKEN" | docker secret create "$SECRET" - >/dev/null
    unset TOKEN
    echo "stored Claude token as swarm secret $SECRET"
  fi
fi

docker build -q --build-arg UID="$(id -u)" --build-arg GID="$(id -g)" -t ai-team:latest . >/dev/null
TAG="ai-team:$(date +%Y%m%d-%H%M%S)"
docker tag ai-team:latest "$TAG"   # unique tag so `stack deploy` actually rolls the service

# --- Codex login (codex backend only) ----------------------------------------------------------
# ChatGPT-subscription device login, run inside the image so it is a separate session from any Codex
# on this host (sharing one would make the two rotate each other's refresh tokens). Codex refreshes
# and rewrites its tokens, so they live in a writable host folder (ai-team/data/codex, gitignored,
# mode 700) mounted via /data — not in a read-only swarm secret.
if [ "$BACKEND" = "codex" ]; then
  mkdir -p "$DATA_HOST_DIR/codex" && chmod 700 "$DATA_HOST_DIR/codex"
  if [ ! -f "$DATA_HOST_DIR/codex/auth.json" ] || $RELOGIN; then
    [ -t 0 ] || { echo "Codex login needs an interactive terminal." >&2; exit 1; }
    echo "== Codex login: open the URL shown, sign in with ChatGPT and enter the code. =="
    echo "   (If it says device login is disabled: ChatGPT → Settings → Security → enable device code auth for Codex.)"
    docker run --rm -it -v "$DATA_HOST_DIR:/data" -e CODEX_HOME=/data/codex "$TAG" \
      codex login --device-auth -c 'cli_auth_credentials_store="file"'
    [ -f "$DATA_HOST_DIR/codex/auth.json" ] || { echo "Codex login did not complete." >&2; exit 1; }
  fi
fi

# Generated each deploy:
# - No git for agents: every .git folder gets an empty tmpfs, every submodule .git file /dev/null
#   (new repos are picked up on the next ./deploy.sh).
# - The Claude token secret, mounted at /run/secrets/claude_oauth_token, readable by the agent user only.
{
  echo 'version: "3.8"'
  echo 'services:'
  echo '  app:'
  echo "    image: $TAG"
  echo '    volumes:'
  for g in "$WORKSPACE_HOST_DIR"/.git "$WORKSPACE_HOST_DIR"/*/.git; do
    [ "$g" = "$PWD/.git" ] && continue   # ai-team/ itself is already hidden whole
    target="/workspace/${g#"$WORKSPACE_HOST_DIR"/}"
    if [ -d "$g" ]; then
      echo "      - {type: tmpfs, target: \"$target\"}"
    elif [ -f "$g" ]; then   # submodule pointer file ("gitdir: ...")
      echo "      - {type: bind, source: /dev/null, target: \"$target\", read_only: true}"
    fi
  done
  if [ -n "$SECRET" ]; then
    echo '    secrets:'
    echo "      - {source: $SECRET, target: claude_oauth_token, uid: \"$(id -u)\", gid: \"$(id -g)\", mode: 0400}"
    echo 'secrets:'
    echo "  $SECRET: {external: true}"
  fi
} > stack.generated.yml

# `docker stack deploy` doesn't read .env for ${VAR} substitution; env_file is read separately.
docker stack deploy --resolve-image never -c stack.yml -c stack.generated.yml "$STACK"

# --- Verify -----------------------------------------------------------------------------------
TIMEOUT="${DEPLOY_TIMEOUT:-180}"
deadline=$((SECONDS + TIMEOUT))
ok() { echo "  ✓ $*"; }
fail() {
  echo "  ✗ $*" >&2
  echo "--- service tasks ---" >&2
  docker service ps "$SERVICE" --no-trunc --format '{{.Image}}  {{.CurrentState}}  {{.Error}}' 2>&1 | head -5 >&2
  echo "--- last logs ---" >&2
  docker service logs --raw --tail 25 "$SERVICE" 2>&1 | tail -25 >&2
  exit 1
}
in_ctr() { docker exec "$CID" "$@"; }

echo "verifying deployment (timeout ${TIMEOUT}s)…"

# 1. Rollout: a container from the new image is running, and swarm didn't roll back.
CID=""
while :; do
  state="$(docker service inspect "$SERVICE" --format '{{if .UpdateStatus}}{{.UpdateStatus.State}}{{end}}')"
  case "$state" in rollback_*|paused) fail "swarm update $state: the new version failed and was rolled back" ;; esac
  for c in $(docker ps -q --filter "label=com.docker.swarm.service.name=$SERVICE"); do
    [ "$(docker inspect -f '{{.Config.Image}}' "$c")" = "$TAG" ] && CID="$c"
  done
  [ -n "$CID" ] && break
  [ "$SECONDS" -lt "$deadline" ] || fail "no running container of $TAG after ${TIMEOUT}s"
  sleep 2
done
ok "rollout: container ${CID:0:12} runs $TAG"

# 2. Docker healthcheck (GET /api/meta from inside the container).
while :; do
  health="$(docker inspect -f '{{.State.Health.Status}}' "$CID" 2>/dev/null || echo exited)"
  [ "$health" = healthy ] && break
  case "$health" in unhealthy|exited) fail "container is $health" ;; esac
  [ "$SECONDS" -lt "$deadline" ] || fail "container still '$health' after ${TIMEOUT}s"
  sleep 2
done
ok "healthcheck: healthy"

# 3. HTTP from the host: API answers with the expected backend and a mounted workspace; dashboard serves.
case "${BACKEND:-langchain}" in
  claude) EXPECT=claude-cli ;;
  codex) EXPECT=codex-cli ;;
  *) EXPECT="$(env_get AI_TEAM_PROVIDER)"; EXPECT="${EXPECT:-mock}" ;;
esac
META="$(curl -sf -m 5 "http://localhost:$AI_TEAM_PORT/api/meta")" || fail "API not reachable at http://localhost:$AI_TEAM_PORT"
err="$(printf '%s' "$META" | python3 -c '
import json, sys
m, want = json.load(sys.stdin), sys.argv[1]
got, root = m["provider"], m["workspace_root"]
assert got == want, f"backend is {got}, expected {want}"
assert root == "/workspace", f"workspace_root is {root}"
assert m["projects"], "workspace has no projects (mount empty?)"' "$EXPECT" 2>&1)" || fail "API meta check: $(printf '%s' "$err" | tail -1)"
ok "api: backend $EXPECT, $(printf '%s' "$META" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["projects"]))') projects in /workspace"
code="$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://localhost:$AI_TEAM_PORT/")"
[ "$code" = 200 ] || fail "dashboard returned HTTP $code"
ok "dashboard: http://localhost:$AI_TEAM_PORT/ → 200"

# 4. Isolation: no git, .git masked, ai-team/ hidden.
in_ctr sh -c '! command -v git >/dev/null' || fail "git binary found in the container"
[ -z "$(in_ctr sh -c 'ls -A /workspace/.git 2>/dev/null')" ] || fail "/workspace/.git is visible"
[ -z "$(in_ctr sh -c 'ls -A /workspace/ai-team 2>/dev/null')" ] || fail "/workspace/ai-team is visible"
ok "isolation: no git, .git masked, ai-team hidden"

# 5. Backend credentials / reachability (free checks; --smoke adds one real call).
case "${BACKEND:-langchain}" in
  claude)
    in_ctr test -s /run/secrets/claude_oauth_token || fail "Claude token secret not mounted"
    ok "claude: $(in_ctr claude --version 2>/dev/null | head -1), token mounted"
    if $SMOKE; then
      out="$(in_ctr sh -c 'CLAUDE_CODE_OAUTH_TOKEN="$(cat /run/secrets/claude_oauth_token)" \
        claude -p "Reply with exactly: OK" --model haiku --tools "" --no-session-persistence' 2>&1 | tail -1)"
      [[ "$out" == *OK* ]] || fail "claude smoke call failed: $out"
      ok "claude smoke call: $out"
    fi ;;
  codex)
    status="$(in_ctr env CODEX_HOME=/data/codex codex login status 2>&1 | tail -1)" || fail "codex: $status"
    ok "codex: $status"
    if $SMOKE; then
      out="$(in_ctr sh -c 'cd /tmp && CODEX_HOME=/data/codex codex exec --ephemeral --skip-git-repo-check \
        -c model_reasoning_effort="\"low\"" "Reply with exactly: OK"' 2>/dev/null | tail -1)"
      [[ "$out" == *OK* ]] || fail "codex smoke call failed: $out"
      ok "codex smoke call: $out"
    fi ;;
  *)
    BASE_URL="$(env_get AI_TEAM_BASE_URL)"
    if [ -n "$BASE_URL" ]; then
      in_ctr python -c "import urllib.request,sys; urllib.request.urlopen(sys.argv[1].rstrip('/') + '/models', timeout=10)" \
        "$BASE_URL" 2>/dev/null || fail "LLM gateway $BASE_URL not reachable from the container"
      ok "langchain: gateway $BASE_URL reachable"
    else
      ok "langchain: provider $EXPECT (no gateway to check)"
    fi ;;
esac

# Only now drop superseded token secrets (ones still attached to a task are skipped by docker).
for old in $(docker secret ls --format '{{.Name}}' | grep "^$SECRET_PREFIX" | grep -vx "${SECRET:-none}" || true); do
  docker secret rm "$old" >/dev/null 2>&1 || true
done
echo "deployed and verified $TAG (backend: ${BACKEND:-langchain}) → http://localhost:$AI_TEAM_PORT"
