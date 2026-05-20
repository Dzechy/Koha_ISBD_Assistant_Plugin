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

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

KOHA_AUTH="/usr/share/koha/lib/C4/Auth.pm"
KOHA_AUTH_BAK="${KOHA_AUTH}.bak"
KOHA_HANDLER="/usr/share/koha/lib/Koha/Plugins/Handler.pm"
KOHA_HANDLER_BAK="${KOHA_HANDLER}.bak"
KOHA_RUN="/usr/share/koha/intranet/cgi-bin/plugins/run.pl"
KOHA_RUN_BAK="${KOHA_RUN}.bak"

usage() {
    cat <<'USAGE'
Usage: scripts/kohafilesbackup.sh backup|restore|apply

backup   Create initial .bak files from the installed Koha files.
restore  Copy Koha .bak files back into the live Koha paths.
apply    Copy this repository's local override files into Koha.

The .bak files should be pristine Koha files from the installed Koha version.
Do not overwrite them with repository-local overrides.
USAGE
}

case "${1:-}" in
    # -------------------------------------------------------------------------
    # Create initial backups from the installed Koha files.
    # Run this before applying repository-local overrides on a fresh Koha install.
    # -------------------------------------------------------------------------
    backup)
        sudo cp "$KOHA_AUTH" "$KOHA_AUTH_BAK"
        sudo cp "$KOHA_HANDLER" "$KOHA_HANDLER_BAK"
        sudo cp "$KOHA_RUN" "$KOHA_RUN_BAK"
        ;;

    # -------------------------------------------------------------------------
    # Restore the installed Koha files from the saved .bak files.
    # Use this when a repository-local override breaks login or plugin dispatch.
    # -------------------------------------------------------------------------
    restore)
        sudo cp "$KOHA_AUTH_BAK" "$KOHA_AUTH"
        sudo cp "$KOHA_HANDLER_BAK" "$KOHA_HANDLER"
        sudo cp "$KOHA_RUN_BAK" "$KOHA_RUN"
        ;;

    # -------------------------------------------------------------------------
    # Apply this repository's local override files into the Koha installation.
    # Re-run backup first after every Koha package upgrade.
    # -------------------------------------------------------------------------
    apply)
        sudo cp "$ROOT/Auth.pm" "$KOHA_AUTH"
        sudo cp "$ROOT/Handler.pm" "$KOHA_HANDLER"
        sudo cp "$ROOT/run.pl" "$KOHA_RUN"
        ;;
    *)
        usage
        exit 2
        ;;
esac
