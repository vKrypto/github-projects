#!/usr/bin/env bash
# Build the image and (re)deploy the ai_team swarm stack on this machine.
set -euo pipefail
cd "$(dirname "$0")"

STACK=ai_team
[ -f .env ] || { cp .env.example .env; echo "created .env from .env.example (provider=mock)"; }
# Root working dir = the only host folder mounted writable into the container.
WORKSPACE_HOST_DIR="$(sed -n 's/^AI_TEAM_WORKSPACE_ROOT=//p' .env | tail -1)"
export WORKSPACE_HOST_DIR="$(realpath "${WORKSPACE_HOST_DIR:-..}")"
export DATA_HOST_DIR="$PWD/data"
export AI_TEAM_PORT="${AI_TEAM_PORT:-8765}"
mkdir -p "$DATA_HOST_DIR"

if [ "$(docker info --format '{{.Swarm.LocalNodeState}}')" != "active" ]; then
  echo "initialising single-node swarm"
  # Control plane bound to loopback: this single-node swarm is not meant to be joined.
  docker swarm init --advertise-addr 127.0.0.1 --listen-addr 127.0.0.1:2377 >/dev/null
fi

docker build -q --build-arg UID="$(id -u)" --build-arg GID="$(id -g)" -t ai-team:latest . >/dev/null
TAG="ai-team:$(date +%Y%m%d-%H%M%S)"
docker tag ai-team:latest "$TAG"   # unique tag so `stack deploy` actually rolls the service

# No git for agents: cover every .git folder with an empty tmpfs and every submodule .git file with /dev/null.
# Generated each deploy, so new repos are picked up on the next ./deploy.sh.
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
} > stack.gitmask.yml

# `docker stack deploy` doesn't read .env for ${VAR} substitution; env_file is read separately.
docker stack deploy --resolve-image never -c stack.yml -c stack.gitmask.yml "$STACK"
echo "deployed $TAG → http://localhost:$AI_TEAM_PORT"
