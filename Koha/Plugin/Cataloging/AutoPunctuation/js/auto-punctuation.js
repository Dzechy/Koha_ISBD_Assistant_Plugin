/*
 * This file is part of Koha.
 *
 * Copyright (C) 2025  Duke Chijimaka Jonathan
 *
 * Koha is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 3 of the License, or
 * (at your option) any later version.
 *
 * Koha is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Koha; if not, see <http://www.gnu.org/licenses>.
 */

/**
 * ISBD Intellisense bootstrapper for Koha cataloging forms.
 */
(function(global, $) {
    'use strict';

    const PENDING_CALLNUMBER_KEY = 'isbdPendingItemCallNumber';

    function currentPath() {
        return (global.location && global.location.pathname ? String(global.location.pathname) : '').toLowerCase();
    }

    function isAddBiblioPage() {
        return currentPath().includes('/cataloguing/addbiblio.pl');
    }

    function isAddItemPage() {
        return currentPath().includes('/cataloguing/additem.pl');
    }

    function readPendingCallNumber() {
        try {
            return (global.sessionStorage && global.sessionStorage.getItem(PENDING_CALLNUMBER_KEY)) || '';
        } catch (err) {
            return '';
        }
    }

    function clearPendingCallNumber() {
        try {
            if (global.sessionStorage) global.sessionStorage.removeItem(PENDING_CALLNUMBER_KEY);
        } catch (err) {
            // ignore storage failures
        }
    }

    function applyPendingCallNumberToAddItem() {
        const pending = (readPendingCallNumber() || '').toString().trim();
        if (!pending) return;
        const selectors = [
            'input[name="items.itemcallnumber"]',
            'input[id^="tag_952_subfield_o_"]',
            '#tag_952_subfield_o_542952'
        ];
        let applied = false;
        selectors.some(selector => {
            const $field = $(selector).first();
            if (!$field.length) return false;
            const current = ($field.val() || '').toString().trim();
            if (!current) {
                $field.val(pending);
                $field.trigger('change');
            }
            applied = true;
            return true;
        });
        if (applied) {
            clearPendingCallNumber();
        }
    }

    $(document).ready(function() {
        if (!global.AutoPunctuation) {
            global.AutoPunctuation = { initialized: false };
        }
        if (isAddItemPage()) {
            applyPendingCallNumberToAddItem();
            return;
        }
        if (!isAddBiblioPage()) {
            return;
        }
        if (!global.AutoPunctuationSettings) {
            console.warn('[ISBD Assistant] Settings not available; plugin idle.');
            return;
        }
        if (!global.ISBDRulesEngine || !global.ISBDIntellisenseUI) {
            console.warn('[ISBD Assistant] Required modules missing; plugin idle.');
            return;
        }
        const settings = global.AutoPunctuationSettings;
        settings.catalogingStandard = 'ISBD';
        if ($('#cat_addbiblio, #record').length) {
            global.ISBDIntellisenseUI.init(settings);
            global.AutoPunctuation.initialized = true;
        }
    });
})(window, window.jQuery);
