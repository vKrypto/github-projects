#!/usr/bin/env bash
# Walks through each project below, in order, asks y/n, and if yes runs
# its environment-setup script from scripts/<project>.sh.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$ROOT/scripts"

PROJECTS=(
  "setup-system"
  "ai-based-repo-template"
  "local-server"
  "switchwale"
  "vKrypto"
  "job-seeker"
  "barebrilliant"
)

for project in "${PROJECTS[@]}"; do
  script="$SCRIPTS_DIR/$project.sh"

  if [ ! -f "$script" ]; then
    echo "Skipping $project -- no setup script at scripts/$project.sh"
    echo
    continue
  fi

  read -r -p "Set up environment for '$project'? [y/N] " answer
  case "$answer" in
    [yY]|[yY][eE][sS])
      echo "--- $project ---"
      if bash "$script"; then
        echo "--- $project: done ---"
      else
        echo "--- $project: FAILED (exit $?) -- continuing to next project ---"
      fi
      ;;
    *)
      echo "Skipping $project"
      ;;
  esac
  echo
done

echo "All projects processed."
