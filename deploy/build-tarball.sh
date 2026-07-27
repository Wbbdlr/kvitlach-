#!/usr/bin/env bash
# Builds the Kvitlach deploy tarball for the adguard-box docker-compose setup.
#
# Packages whole backend/, frontend/, deploy/ directories (minus the
# .gitignore'd junk below) rather than a hand-picked file list -- a
# hand-picked list silently drops anything new. That's exactly what happened
# to frontend/nginx.conf: every tarball built by hand-listing files omitted
# it, and it only ever worked because the server's frontend/ directory
# already had a copy sitting there from an earlier, more complete setup. The
# moment that directory got wiped and rebuilt purely from a hand-picked
# tarball, the frontend Docker build broke on a missing COPY source.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$HOME/Downloads/kvitlach-deploy.tar.gz}"

cd "$REPO_ROOT"
tar --force-local -czf "$OUT" \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  --exclude='tmp' \
  backend frontend deploy

echo "Built: $OUT"
