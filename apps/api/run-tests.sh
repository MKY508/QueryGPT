#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PYTHON="$SCRIPT_DIR/.venv/bin/python"

if [ "$#" -eq 0 ]; then
  set -- "$SCRIPT_DIR/tests"
fi

if "$VENV_PYTHON" -c "import pytest" >/dev/null 2>&1; then
  exec "$VENV_PYTHON" -m pytest "$@"
fi

site_packages_matches=("$SCRIPT_DIR"/.venv/lib/python*/site-packages)
if [ ! -d "${site_packages_matches[0]}" ]; then
  echo "Could not locate API site-packages under $SCRIPT_DIR/.venv" >&2
  exit 1
fi
SITE_PACKAGES="${site_packages_matches[0]}"

export PYTHONPATH="$SCRIPT_DIR:$SITE_PACKAGES${PYTHONPATH:+:$PYTHONPATH}"
exec python3 -m pytest "$@"
