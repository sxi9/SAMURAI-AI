#!/usr/bin/env bash
# SAMURAI installer / launcher for Linux and macOS.
#   ./install.sh            install (interactive)
#   ./install.sh --yes      install with defaults
#   ./install.sh --start    start the control panel + services
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python)
[ -z "$PY" ] && { echo "Python 3.9+ is required (apt install python3 python3-venv / brew install python)"; exit 1; }
if [ "$1" = "--start" ] && [ -x .venv/bin/python ]; then
  exec .venv/bin/python servers/samurai_panel.py --autostart
fi
exec "$PY" install.py "$@"
