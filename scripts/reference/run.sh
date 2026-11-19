#!/bin/sh
# Rebuild the pinned environment and regenerate tests/fixtures/reference/*.json. Needs Python 3.9 and network for pip.
set -e
cd "$(dirname "$0")"
[ -d .venv ] || python3.9 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
.venv/bin/python pvlib_reference.py
