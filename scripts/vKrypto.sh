#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../vKrypto"

echo "Creating Python venv..."
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip -q

echo "Installing root requirements.txt (API service: fastapi/uvicorn/boto3/...)..."
pip install -r requirements.txt

echo "Installing readme_generator/requirements.txt (README templating tool)..."
pip install -r readme_generator/requirements.txt

deactivate
echo "Done. Activate with: source vKrypto/.venv/bin/activate"
