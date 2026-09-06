#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../barebrilliant"

echo "Installing client (npm) dependencies..."
(
  cd client
  npm install
  if [ -f .env.example ] && [ ! -f .env ]; then
    cp .env.example .env
    echo "Created client/.env from .env.example -- fill in real values before running."
  fi
)

echo "Installing server (npm) dependencies..."
(
  cd server
  npm install
  if [ -f .env.example ] && [ ! -f .env ]; then
    cp .env.example .env
    echo "Created server/.env from .env.example -- fill in real values before running."
  fi
)
