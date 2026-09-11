#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ ! -d node_modules/playwright ]]; then
  npm ci
fi
exec node cli.mjs "$@"
