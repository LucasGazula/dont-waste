#!/usr/bin/env sh
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "Don't Waste requires Node.js 22 or newer." >&2
  exit 1
fi

major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 22 ]; then
  echo "Don't Waste requires Node.js 22 or newer (found $(node --version))." >&2
  exit 1
fi

npm install --global dont-waste@latest
dont-waste init "$@"
