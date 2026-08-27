#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Python deps for vocal-onset detection (auto-sync lyrics).
# Use lockfile-driven sync only — never mutate the manifest here.
if [ -f pyproject.toml ] && command -v uv >/dev/null 2>&1; then
  uv sync >/dev/null 2>&1 || true
elif command -v pip3 >/dev/null 2>&1; then
  pip3 install --quiet librosa soundfile numpy || true
fi
