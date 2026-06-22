#!/usr/bin/env bash
# Screenshot a route of the running app in light + dark.
#
# Deliberately DUMB and SAFE: it assumes the user already has a dev server
# running and only ever READS from it. It never starts, stops, or kills any
# server — no process management, no orphans, no risk.
#
# Exit codes:
#   0  success
#   2  no dev server responding on :3000 (ask the user to run `pnpm dev`)
#   3  Playwright venv missing (run setup-screenshots.sh)
#
# Usage:
#   capture.sh --name baseline-list                 # route "/", light + dark
#   capture.sh --name scoped --path "/?folder=foo"  # extra args pass to shoot.py
set -uo pipefail

VENV="${DESIGN_PW_VENV:-$HOME/.cache/design-playwright-venv}"
PY="$VENV/bin/python"
PORT="${DESIGN_PORT:-3000}"
BASE="http://localhost:$PORT"

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHOOT="$SKILL_DIR/scripts/shoot.py"

if [ ! -x "$PY" ]; then
  echo "ERROR: Playwright venv missing at $VENV." >&2
  echo "Run: bash $SKILL_DIR/scripts/setup-screenshots.sh" >&2
  exit 3
fi

if ! curl -sf -o /dev/null -m 8 "$BASE"; then
  echo "No dev server responding on $BASE." >&2
  echo "Please start it yourself ('pnpm dev'), then I'll screenshot against it." >&2
  exit 2
fi

echo "Capturing $BASE (reusing your running dev server)"
"$PY" "$SHOOT" --base "$BASE" "$@"
