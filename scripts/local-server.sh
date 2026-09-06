#!/usr/bin/env bash
# local-server has no local dev environment to set up on this workstation.
# Its own scripts (reception/configure.sh, networkeye/configure.sh)
# provision remote Raspberry Pi / Proxmox hosts over SSH -- running them
# here would be wrong, so this is intentionally a no-op.
set -euo pipefail
echo "Nothing to set up locally for local-server -- it's infra docs/config"
echo "for remote hosts (Reception, NetworkEye, Proxmox), not a local dev project."
