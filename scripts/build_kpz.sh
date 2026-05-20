#!/usr/bin/env bash
# This file is part of Koha.
#
# Copyright (C) 2025  Duke Chijimaka Jonathan
#
# Koha is free software; you can redistribute it and/or modify it
# under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 3 of the License, or
# (at your option) any later version.
#
# Koha is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with Koha; if not, see <http://www.gnu.org/licenses>.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_PM="$ROOT_DIR/Koha/Plugin/Cataloging/AutoPunctuation.pm"
DIST_DIR="${DIST_DIR:-$ROOT_DIR/dist}"

if [[ ! -f "$PLUGIN_PM" ]]; then
  echo "Missing plugin entrypoint: $PLUGIN_PM" >&2
  exit 1
fi

VERSION="$(perl -ne 'if (/^our\s+\$VERSION\s*=\s*"([^"]+)";/) { print $1; exit }' "$PLUGIN_PM")"
if [[ -z "$VERSION" ]]; then
  VERSION="dev"
fi

mkdir -p "$DIST_DIR"
OUT_FILE="$DIST_DIR/Koha_ISBD_Assistant-${VERSION}.kpz"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/Koha"
cp -R "$ROOT_DIR/Koha/." "$TMP_DIR/Koha/"
cp "$ROOT_DIR/LICENSE" "$TMP_DIR/" 2>/dev/null || true
cp "$ROOT_DIR/README.md" "$TMP_DIR/" 2>/dev/null || true
cp -R "$ROOT_DIR/docs" "$TMP_DIR/" 2>/dev/null || true

(
  cd "$TMP_DIR"
  rm -f "$OUT_FILE"
  ZIP_ITEMS=(Koha)
  [[ -f LICENSE ]] && ZIP_ITEMS+=(LICENSE)
  [[ -f README.md ]] && ZIP_ITEMS+=(README.md)
  [[ -d docs ]] && ZIP_ITEMS+=(docs)
  zip -r -q "$OUT_FILE" "${ZIP_ITEMS[@]}"
)

echo "Built $OUT_FILE"
