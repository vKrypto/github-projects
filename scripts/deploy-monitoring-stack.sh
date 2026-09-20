#!/usr/bin/env bash
# Deploys monitoring_stack to the Proxmox Swarm VM (docker-vm, 192.168.100.10).
# Thin wrapper around monitoring_stack/deploy.sh -- all logic lives there.
#
# Deliberately NOT named monitoring_stack.sh: setup-env.sh runs scripts/<project>.sh
# as a local environment setup step, and this pushes to a remote host.
#
#   scripts/deploy-monitoring-stack.sh --dry-run   read-only: checks + what would change
#   scripts/deploy-monitoring-stack.sh             create data dirs, copy config, docker stack deploy
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../monitoring_stack"

[ -x ./deploy.sh ] || { echo "monitoring_stack/deploy.sh not found -- run 'git submodule update --init monitoring_stack'" >&2; exit 1; }
[ -f .env ] || { echo "monitoring_stack/.env missing -- cp .env.example .env and fill it in" >&2; exit 1; }

exec ./deploy.sh "$@"
