#!/usr/bin/env bash
set -e

FOLIO_DIR="${FOLIO_DIR:-/content/Folio}"

cd "$FOLIO_DIR"

npm ci --prefer-offline 2>&1 | tail -3

npm run build 2>&1 | tail -5

echo "✓ Folio built"
