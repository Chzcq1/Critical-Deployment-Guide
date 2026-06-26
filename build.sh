#!/usr/bin/env bash
set -e

PROJECT_DIR="$(pwd)"

echo "--- Installing Python dependencies ---"
pip install --upgrade pip
pip install -r requirements.txt

echo "--- Installing pnpm 9 in /tmp (Render filesystem-safe) ---"
mkdir -p /tmp/pnpm-env
cd /tmp/pnpm-env
npm init --yes > /dev/null
npm install pnpm@9 > /dev/null
export PATH="/tmp/pnpm-env/node_modules/.bin:$PATH"

echo "--- Building React frontend ---"
cd "$PROJECT_DIR"
pnpm install
BASE_PATH=/ pnpm --filter @workspace/store run build

echo "--- Build complete ---"
