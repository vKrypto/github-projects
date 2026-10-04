#!/usr/bin/env bash
# Build the image and (re)deploy the ai_team swarm stack on this machine.
#   ./deploy.sh            deploy (logs in first if the claude/codex backend has no credentials yet)
#   ./deploy.sh --relogin  log in again (new Claude token / new Codex device login), then deploy
# Subscription credentials are checked with one tiny real call before deploying, and re-login runs
# if they are rejected. Every deploy is then verified (rollout, healthcheck, HTTP, isolation); the script
# exits non-zero with diagnostics if any check fails. DEPLOY_TIMEOUT (default 180s) bounds the wait.
set -euo pipefail
cd "$(dirname "$0")"

STACK=ai_team
SERVICE="${STACK}_app"
SECRET_PREFIX=ai_team_claude_token_
RELOGIN=false
for arg in "$@"; do
  case "$arg" in
    --relogin) RELOGIN=true ;;
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

docker build -q --build-arg UID="$(id -u)" --build-arg GID="$(id -g)" -t ai-team:latest . >/dev/null
TAG="ai-team:$(date +%Y%m%d-%H%M%S)"
docker tag ai-team:latest "$TAG"   # unique tag so `stack deploy` actually rolls the service

# --- Subscription credentials: validate, re-login if invalid ---------------------------------------
# Credentials live in ai-team/data/ (gitignored, mode 700), never in .env, git or the image.
# Before every deploy they are checked with one tiny real call from a throwaway container of the new
# image. If the call is rejected (or --relogin), the script logs in again and updates the file.
need_tty() { [ -t 0 ] || { echo "$1 needs an interactive terminal." >&2; exit 1; }; }
SMOKE_PROMPT="Reply with exactly: OK"

# Claude: long-lived inference-only token from `claude setup-token`, kept in data/claude/oauth_token
# and handed to the stack as a swarm secret named after the token's hash (recreated only on change).
CLAUDE_DIR="$DATA_HOST_DIR/claude"
CLAUDE_TOKEN_FILE="${CLAUDE_TOKEN_FILE:-$CLAUDE_DIR/oauth_token}"
find_claude() {
  command -v claude 2>/dev/null && return
  ls -1d "$HOME"/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | sort -V | tail -1
}
claude_check() {   # prints the CLI's answer; succeeds only if the token works
  [ -s "$CLAUDE_TOKEN_FILE" ] || { echo "no token stored"; return 1; }
  local out
  out="$(CLAUDE_CODE_OAUTH_TOKEN="$(cat "$CLAUDE_TOKEN_FILE")" docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN "$TAG" \
        claude -p "$SMOKE_PROMPT" --model haiku --tools "" --no-session-persistence 2>&1 | tail -1)"
  echo "$out"
  [[ "$out" == *OK* ]]
}
claude_login() {
  local token claude
  token="${CLAUDE_CODE_OAUTH_TOKEN:-}"
  if [ -z "$token" ]; then
    need_tty "Claude login"
    claude="$(find_claude)"
    echo "== Claude login: approve in the browser, then copy the token it prints. =="
    if [ -n "$claude" ]; then
      "$claude" setup-token
    else   # no host CLI: run it from the image
      docker run --rm -it "$TAG" claude setup-token
    fi
    read -rsp "Paste the token (input hidden): " token; echo
  fi
  token="$(printf '%s' "$token" | tr -d '[:space:]')"
  [[ "$token" == sk-ant-* ]] || { echo "that doesn't look like a Claude token (expected sk-ant-…)" >&2; exit 1; }
  ( umask 077; printf '%s' "$token" > "$CLAUDE_TOKEN_FILE" )
  echo "saved token to ${CLAUDE_TOKEN_FILE#"$PWD"/}"
}

# Codex: ChatGPT device login run inside the image (separate session from any host Codex, so the
# two never rotate each other's refresh tokens). Codex rewrites its tokens on refresh, so they stay
# in the writable data/codex folder, mounted via /data.
CODEX_DIR="$DATA_HOST_DIR/codex"
codex_check() {
  [ -s "$CODEX_DIR/auth.json" ] || { echo "not logged in"; return 1; }
  local out
  out="$(docker run --rm -v "$DATA_HOST_DIR:/data" -e CODEX_HOME=/data/codex -w /tmp "$TAG" \
        codex exec --ephemeral --skip-git-repo-check -c 'model_reasoning_effort="low"' "$SMOKE_PROMPT" 2>&1 | tail -1)"
  echo "$out"
  [[ "$out" == *OK* ]]
}
codex_login() {
  need_tty "Codex login"
  echo "== Codex login: open the URL shown, sign in with ChatGPT and enter the code. =="
  echo "   (If device login is disabled: ChatGPT → Settings → Security → enable device code auth for Codex.)"
  docker run --rm -it -v "$DATA_HOST_DIR:/data" -e CODEX_HOME=/data/codex "$TAG" \
    codex login --device-auth -c 'cli_auth_credentials_store="file"'
}

ensure_login() {   # ensure_login <name> <check_fn> <login_fn>
  local name="$1" check="$2" login="$3" out
  if ! $RELOGIN; then
    if out="$($check)"; then echo "  ✓ $name credentials valid"; return; fi
    echo "  ! $name credentials invalid ($out); logging in again"
  fi
  $login
  out="$($check)" || { echo "  ✗ $name still rejected after login: $out" >&2; exit 1; }
  echo "  ✓ $name credentials valid"
}

SECRET=""
case "$BACKEND" in
  claude)
    mkdir -p "$CLAUDE_DIR" && chmod 700 "$CLAUDE_DIR"
    if [ ! -s "$CLAUDE_TOKEN_FILE" ] && [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then claude_login; fi
    echo "checking Claude login…"
    ensure_login Claude claude_check claude_login
    SECRET="$SECRET_PREFIX$(sha256sum "$CLAUDE_TOKEN_FILE" | cut -c1-12)"
    if ! docker secret inspect "$SECRET" >/dev/null 2>&1; then
      docker secret create "$SECRET" "$CLAUDE_TOKEN_FILE" >/dev/null
      echo "  ✓ created swarm secret $SECRET"
    fi ;;
  codex)
    mkdir -p "$CODEX_DIR" && chmod 700 "$CODEX_DIR"
    echo "checking Codex login…"
    ensure_login Codex codex_check codex_login ;;
esac

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

# 5. Backend credentials reached the running container / gateway reachable.
case "${BACKEND:-langchain}" in
  claude)
    in_ctr test -s /run/secrets/claude_oauth_token || fail "Claude token secret not mounted"
    ok "claude: $(in_ctr claude --version 2>/dev/null | head -1), token mounted" ;;
  codex)
    status="$(in_ctr env CODEX_HOME=/data/codex codex login status 2>&1 | tail -1)" || fail "codex: $status"
    ok "codex: $status" ;;
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
