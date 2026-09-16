#!/usr/bin/env bash
# Syncs the github-projects main repo and every submodule: fetch, auto-commit
# any uncommitted changes (same "Auto Syncing: ..." convention as
# /custom_bin/commit), fast-forward pull, then push -- all on whatever
# branch is currently checked out in each repo. A repo is never merged/
# rebased automatically: if --ff-only can't apply cleanly, it's left as-is
# and reported rather than force-touched.
# See crontab -l for the schedule this normally runs on.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

LOG_DIR="$HOME/.local/state/github-sync"
LOG_FILE="$LOG_DIR/sync.log"
mkdir -p "$LOG_DIR"
exec >> "$LOG_FILE" 2>&1

echo "===== $(date -Is) ====="

declare -a SYNCED=() COMMITTED=() FAILED=()

# Retries a network git command a few times with a short pause -- this
# workstation's DNS resolver has been observed to blip transiently
# (github.com fails to resolve for a moment, then works again seconds
# later), and a scheduled run shouldn't report a failure for that.
retry() {
  local attempt
  for attempt in 1 2 3; do
    if "$@"; then
      return 0
    fi
    [ "$attempt" -lt 3 ] && sleep 5
  done
  return 1
}

sync_repo() {
  local dir="$1" label="$2" branch

  branch=$(git -C "$dir" symbolic-ref --short -q HEAD || true)
  if [ -z "$branch" ]; then
    echo "[$label] detached HEAD -- skipping (no branch to push)"
    FAILED+=("$label")
    return
  fi

  echo "[$label] branch '$branch' -- fetching"
  if ! retry git -C "$dir" fetch origin "$branch" --quiet; then
    echo "[$label] fetch failed (retried 3x)"
    FAILED+=("$label")
    return
  fi

  if [ -n "$(git -C "$dir" status --porcelain)" ]; then
    echo "[$label] uncommitted changes present -- auto-committing"
    git -C "$dir" add -A
    if git -C "$dir" commit --quiet -m "Auto Syncing: Auto commit"; then
      echo "[$label] committed local changes"
      COMMITTED+=("$label")
    else
      echo "[$label] commit failed -- leaving as-is, not pulling/pushing"
      FAILED+=("$label")
      return
    fi
  fi

  if ! retry git -C "$dir" pull --ff-only origin "$branch" --quiet; then
    echo "[$label] pull --ff-only failed (local/remote history diverged?) -- leaving as-is, not pushing"
    FAILED+=("$label")
    return
  fi

  if ! retry git -C "$dir" push origin "HEAD:$branch" --quiet; then
    echo "[$label] push failed (retried 3x -- auth, diverged, or rejected; check log above)"
    FAILED+=("$label")
    return
  fi

  SYNCED+=("$label")
}

sync_repo "." "main (github-projects)"

while IFS= read -r sm_path; do
  [ -n "$sm_path" ] && sync_repo "$sm_path" "$sm_path"
done < <(git config --file .gitmodules --get-regexp path | awk '{print $2}')

if [ -n "$(git status --porcelain)" ]; then
  echo "[main] submodule pointers changed by the syncs just run -- committing and pushing"
  sync_repo "." "main (github-projects) [submodule pointers]"
fi

echo "Summary: synced=[${SYNCED[*]:-}] committed=[${COMMITTED[*]:-}] failed=[${FAILED[*]:-}]"
echo

# Keep the log from growing unbounded.
tail -n 2000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"

[ ${#FAILED[@]} -eq 0 ]
