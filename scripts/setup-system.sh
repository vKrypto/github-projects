#!/usr/bin/env bash
# Runs setup-system's own installer. It's interactive (asks what to
# install -- base tools, Docker, Docker Desktop, etc.) and may prompt
# for sudo; that's expected, this just hands off to it.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../setup-system"
bash install.sh
