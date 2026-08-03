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

KOHA_AUTH="/usr/share/koha/lib/C4/Auth.pm"
KOHA_AUTH_BAK="${KOHA_AUTH}.bak"
KOHA_HANDLER="/usr/share/koha/lib/Koha/Plugins/Handler.pm"
KOHA_HANDLER_BAK="${KOHA_HANDLER}.bak"
KOHA_RUN="/usr/share/koha/intranet/cgi-bin/plugins/run.pl"
KOHA_RUN_BAK="${KOHA_RUN}.bak"

usage() {
    cat <<'USAGE'
Usage: scripts/kohafilesbackup.sh backup|restore

backup   Create initial .bak files from the installed Koha files.
restore  Copy Koha .bak files back into the live Koha paths.

The .bak files should be pristine Koha files from the installed Koha version.
Do not overwrite them with repository-local overrides.
Plugin version 1.0.1 and newer does not require Koha core-file overrides.
USAGE
}

case "${1:-}" in
    # -------------------------------------------------------------------------
    # Create initial backups from the installed Koha files without replacing
    # an existing recovery copy.
    # -------------------------------------------------------------------------
    backup)
        sudo cp -n "$KOHA_AUTH" "$KOHA_AUTH_BAK"
        sudo cp -n "$KOHA_HANDLER" "$KOHA_HANDLER_BAK"
        sudo cp -n "$KOHA_RUN" "$KOHA_RUN_BAK"
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

    apply)
        echo "The apply action was removed: plugin 1.0.1+ supports stock Koha 25.11/26.05 files." >&2
        echo "Restore package-owned Koha files and install the current KPZ instead." >&2
        exit 2
        ;;
    *)
        usage
        exit 2
        ;;
esac
