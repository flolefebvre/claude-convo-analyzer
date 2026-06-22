#!/usr/bin/env bash
# One-time bootstrap for the screenshot loop. Idempotent — safe to re-run.
# Creates a Python venv with Playwright + Chromium OUTSIDE the repo so it never
# pollutes git. Prints the venv python path the design-pass skill should use.
set -euo pipefail

VENV="${DESIGN_PW_VENV:-$HOME/.cache/design-playwright-venv}"

if [ ! -x "$VENV/bin/python" ]; then
  echo "Creating Playwright venv at $VENV"
  if command -v uv >/dev/null 2>&1; then
    uv venv "$VENV"
    VIRTUAL_ENV="$VENV" uv pip install --python "$VENV/bin/python" playwright
  else
    python3 -m venv "$VENV"
    "$VENV/bin/python" -m pip install --upgrade pip playwright
  fi
else
  echo "venv already present at $VENV"
fi

# Downloads to ~/.cache/ms-playwright; no-op if already there.
"$VENV/bin/python" -m playwright install chromium

echo "READY. Use this python for screenshot scripts:"
echo "  $VENV/bin/python"
