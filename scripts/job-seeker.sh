#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../job-seeker"

echo "Setting up backend (Python) environment..."
(
  cd backend
  python3 -m venv .venv
  source .venv/bin/activate
  pip install --upgrade pip -q
  pip install -r requirements.txt
  if [ -f .env.example ] && [ ! -f .env ]; then
    cp .env.example .env
    echo "Created backend/.env from .env.example -- fill in real values before running."
  fi
)

echo "Installing frontend (npm) dependencies..."
(
  cd frontend
  npm install
  if [ -f .env.example ] && [ ! -f .env ]; then
    cp .env.example .env
    echo "Created frontend/.env from .env.example -- fill in real values before running."
  fi
)

echo "Done. Backend venv: job-seeker/backend/.venv, activate with 'source .venv/bin/activate'."
