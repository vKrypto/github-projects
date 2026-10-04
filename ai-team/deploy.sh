#!/usr/bin/env bash
# Build the image and (re)deploy the ai_team swarm stack on this machine.
#   ./deploy.sh            deploy (logs in first if the claude/codex backend has no credentials yet)
#   ./deploy.sh --relogin  log in again (new Claude token / new Codex device login), then deploy
set -euo pipefail
cd "$(dirname "$0")"

STACK=ai_team
SECRET_PREFIX=ai_team_claude_token_
RELOGIN=false
[ "${1:-}" = "--relogin" ] && RELOGIN=true

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

# Drop superseded token secrets (ones still attached to a running task are skipped by docker).
for old in $(docker secret ls --format '{{.Name}}' | grep "^$SECRET_PREFIX" | grep -vx "${SECRET:-none}" || true); do
  docker secret rm "$old" >/dev/null 2>&1 || true
done
echo "deployed $TAG (backend: ${BACKEND:-langchain}) → http://localhost:$AI_TEAM_PORT"
