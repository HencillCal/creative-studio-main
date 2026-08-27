#!/usr/bin/env bash
# Upgrade the bundled yt-dlp binary to the newest release.
#
# YouTube changes its bot-detection signatures every few weeks, so the
# player_client fallbacks in artifacts/api-server/src/routes/media.ts only
# keep working if yt-dlp itself stays current. Run this script (or wire it
# into a scheduled job) whenever downloads start failing with a sign-in /
# bot-block error, or just on a monthly cadence as preventive maintenance.
#
# Prefers `uv` (so pyproject.toml + uv.lock stay in sync). Falls back to
# `pip3 install --upgrade` when uv is not available.

set -euo pipefail

cd "$(dirname "$0")/.."

if command -v uv >/dev/null 2>&1; then
  echo "Upgrading yt-dlp via uv..."
  uv lock --upgrade-package yt-dlp
  uv sync
elif command -v pip3 >/dev/null 2>&1; then
  echo "uv not found; upgrading yt-dlp via pip3..."
  # Target .pythonlibs explicitly so we upgrade the same binary the API
  # server resolves first (`.pythonlibs/bin/yt-dlp`). Otherwise a PATH
  # install can leave a stale .pythonlibs binary shadowing the upgrade.
  if [ -d ".pythonlibs" ]; then
    pip3 install --upgrade --prefix .pythonlibs yt-dlp
  else
    pip3 install --upgrade yt-dlp
  fi
else
  echo "ERROR: neither uv nor pip3 is available; cannot upgrade yt-dlp." >&2
  exit 1
fi

YTDLP_BIN=""
if [ -x ".pythonlibs/bin/yt-dlp" ]; then
  YTDLP_BIN=".pythonlibs/bin/yt-dlp"
elif command -v yt-dlp >/dev/null 2>&1; then
  YTDLP_BIN="yt-dlp"
fi

if [ -n "$YTDLP_BIN" ]; then
  echo "yt-dlp now at: $($YTDLP_BIN --version)"
else
  echo "WARNING: yt-dlp binary not found on PATH after upgrade." >&2
fi
