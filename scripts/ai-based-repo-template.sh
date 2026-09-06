#!/usr/bin/env bash
# Installs this template's shared Claude Code config onto this machine
# (global_config/ -> ~/.claude/). Deliberately NOT sync-global-config.sh
# in this repo -- that one runs the opposite direction (live ~/.claude/
# -> global_config/, for updating the repo from this machine), which
# isn't environment setup.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../ai-based-repo-template"
bash global_config/install.sh
