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

(function(global) {
    'use strict';

    const DEFAULT_RULES = Object.freeze({ rules: [] });
    const ruleWarnings = new Set();

    function warnRule(message) {
        if (!message || ruleWarnings.has(message)) return;
        ruleWarnings.add(message);
        if (global.ISBDRulesEngine && typeof global.ISBDRulesEngine.onWarning === 'function') {
            global.ISBDRulesEngine.onWarning(message);
        }
    }

    function safeRegExp(pattern, label) {
        if (!pattern) return null;
        if (/\([^)]*(?:\+|\*|\{\d+,?\d*\})[^)]*\)(?:\+|\*|\?|\{\d+,?\d*\})/.test(pattern)) {
            warnRule(`${label} regex is too complex.`);
            return null;
        }
        try {
            return new RegExp(pattern);
        } catch (err) {
            warnRule(`${label} regex is invalid.`);
            return null;
        }
    }

    function normalizeRules(rulePack, customRulesRaw) {
        const base = rulePack && rulePack.rules ? rulePack.rules.slice() : [];
        let custom = {};
        if (customRulesRaw) {
            try {
                custom = typeof customRulesRaw === 'string' ? JSON.parse(customRulesRaw) : customRulesRaw;
            } catch (err) {
                custom = {};
            }
        }
        if (custom.rules && Array.isArray(custom.rules)) {
            return base.concat(custom.rules);
        }
        return base;
    }

    function indicatorMatch(value, ruleValue) {
        if (ruleValue === undefined || ruleValue === null || ruleValue === '') return true;
        if (ruleValue === '*') return true;
        if (Array.isArray(ruleValue)) return ruleValue.includes(value);
        return ruleValue === value;
    }

    function ruleMatches(rule, tag, subfield, ind1, ind2) {
        if (!rule) return false;
        if (rule.tag && rule.tag !== tag) return false;
        if (rule.tag_pattern) {
            const regex = safeRegExp(rule.tag_pattern, `Rule ${rule.id || 'unknown'} tag_pattern`);
            if (!regex || !regex.test(tag)) return false;
        }
        if (!indicatorMatch(ind1 || '', rule.ind1)) return false;
        if (!indicatorMatch(ind2 || '', rule.ind2)) return false;
        if (rule.subfields && Array.isArray(rule.subfields)) {
            return rule.subfields.map(code => code.toLowerCase()).includes(subfield.toLowerCase());
        }
        if (rule.subfield_pattern) {
            const regex = safeRegExp(rule.subfield_pattern, `Rule ${rule.id || 'unknown'} subfield_pattern`);
            if (!regex) return false;
            return regex.test(subfield);
        }
        return true;
    }

    function normalizeOccurrence(value) {
        if (value === undefined || value === null || value === '') return 0;
        const parsed = Number.parseInt(value, 10);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    function resolveSuffix(check, field, code, index) {
        const mode = check.suffix_mode || 'always';
        const following = check.when_following_subfields || [];
        let hasFollowing = false;
        let followingCode = '';
        let prefixOverride = '';
        if (Array.isArray(following) && field && Array.isArray(field.subfields)) {
            const wanted = following.map(x => x.toLowerCase());
            const startIndex = typeof index === 'number' ? index + 1 : 0;
            for (let i = startIndex; i < field.subfields.length; i++) {
                const sub = field.subfields[i];
                if (!sub || !sub.code || !String(sub.value || '').trim()) continue;
                if (startIndex === 0 && sub.code.toLowerCase() === code.toLowerCase()) continue;
                if (wanted.includes(sub.code.toLowerCase())) {
                    hasFollowing = true;
                    followingCode = sub.code.toLowerCase();
                    if (!prefixOverride && Array.isArray(check.suffix_if_following_prefixes)) {
                        const trimmedValue = String(sub.value || '').trim();
                        check.suffix_if_following_prefixes.some(entry => {
                            if (!entry || !entry.prefix) return false;
                            const prefix = String(entry.prefix).trim();
                            if (!prefix) return false;
                            if (trimmedValue.startsWith(prefix)) {
                                prefixOverride = entry.suffix || '';
                                return true;
                            }
                            return false;
                        });
                    }
                    break;
                }
            }
        }
        if (mode === 'conditional_following') {
            const byCode = check.suffix_by_following_subfield || {};
            const followingSuffix = prefixOverride
                || (followingCode && Object.prototype.hasOwnProperty.call(byCode, followingCode) ? byCode[followingCode] : null)
                || check.suffix_if_following
                || '';
            return { suffix: hasFollowing ? followingSuffix : (check.suffix_if_last || check.suffix || ''), hasFollowing, mode };
        }
        if (mode === 'when_following') {
            return { suffix: hasFollowing ? (check.suffix_if_following || check.suffix || '') : '', hasFollowing, mode };
        }
        if (mode === 'when_last') {
            return { suffix: hasFollowing ? '' : (check.suffix_if_last || check.suffix || ''), hasFollowing, mode };
        }
        return { suffix: check.suffix || '', hasFollowing, mode };
    }

    function resolvePrefix(check, field, subfield, index) {
        const mode = check.prefix_mode || 'always';
        const preceding = check.when_preceding_subfields || [];
        let hasPreceding = false;
        let precedingCode = '';
        if (Array.isArray(preceding) && field && Array.isArray(field.subfields)) {
            const wanted = preceding.map(x => x.toLowerCase());
            const stopIndex = typeof index === 'number' ? index : field.subfields.length;
            for (let i = 0; i < stopIndex; i++) {
                const sub = field.subfields[i];
                if (!sub || !sub.code) continue;
                if (!String(sub.value || '').trim()) continue;
                if (wanted.includes(sub.code.toLowerCase())) {
                    hasPreceding = true;
                    precedingCode = sub.code.toLowerCase();
                }
            }
        }
        if (mode === 'conditional_preceding') {
            const byCode = check.prefix_by_preceding_subfield || {};
            return hasPreceding
                ? (precedingCode && Object.prototype.hasOwnProperty.call(byCode, precedingCode) ? byCode[precedingCode] : (check.prefix_if_preceding || check.prefix || ''))
                : (check.prefix_if_first || '');
        }
        if (mode === 'when_preceding') {
            return hasPreceding ? (check.prefix_if_preceding || check.prefix || '') : '';
        }
        if (mode === 'when_first') {
            return hasPreceding ? '' : (check.prefix_if_first || check.prefix || '');
        }
        return check.prefix || '';
    }

    function endsWithAny(value, endings) {
        if (!value || !Array.isArray(endings)) return false;
        return endings.some(end => end && value.endsWith(end));
    }

    function stripEndings(value, endings) {
        if (!value || !Array.isArray(endings)) return value || '';
        let text = value;
        endings.forEach(end => {
            if (!end) return;
            if (text.endsWith(end)) {
                text = text.slice(0, text.length - end.length);
            }
        });
        return text;
    }

    function stripRedundantSuffixPunctuation(value, suffix) {
        let text = (value || '').replace(/\s+$/, '');
        const suffixCore = String(suffix || '').trim();
        if (!suffixCore) return text;

        // Existing prescribed punctuation may be wrong for this boundary, but a
        // terminal period can also be meaningful data ("p.", "ill.", "Co.").
        // Only remove the exact punctuation mark the rule is about to prescribe.
        const last = suffixCore.charAt(suffixCore.length - 1);
        if (last && /[,;:+/]/.test(last)) {
            const re = new RegExp(`\\s*${escapeRegExp(last)}\\s*$`);
            return text.replace(re, '');
        }
        if (last === '.') {
            return text.replace(/\s+$/, '');
        }
        return text;
    }

    function normalizePunctuation(value) {
        let text = value || '';
        // Strip space before prescribed punctuation marks (except opening parens/brackets)
        // ISBD A.3.2.1: prescribed punctuation is preceded by a space, but commas and
        // points are only followed by a space. Do NOT strip space before ( or [ per A.3.2.2.
        text = text.replace(/\s+([,!?])/g, '$1');
        // ISBD A.3.2.2: closing parenthesis/bracket followed by comma, point, or
        // any punctuation — no space between them.
        text = text.replace(/([\]\)\}])\s+([,;:!?.\]])/g, '$1$2');
        // ISBD A.3.2.3 + A.3.2.7: Area separator normalization with double-punctuation
        // preservation. ".. — " (double period before area separator) is correct per
        // A.3.2.7 when abbreviation period meets prescribed period.
        text = text.replace(/\.{2}\s*[\u2012\u2013\u2014-]\s*/g, '.. \u2014 ');
        text = text.replace(/\.\s*\.\s*[\u2012\u2013\u2014-]\s*/g, '.. \u2014 ');
        text = text.replace(/\b(ed|ill|p|v|vol|no|etc|Co|Inc|Ltd|Dr|Mr|Mrs|Ms|Jr|Sr)\.\s*[\u2012\u2013\u2014-]\s*/gi, '$1.. \u2014 ');
        text = text.replace(/\s*\.\s*[\u2012\u2013\u2014-]\s*/g, '. \u2014 ');
        // Comma-space: ensure space after comma
        // NOT before digits or closing parens/brackets
        text = text.replace(/,\s*([^\s\]\)\}\d])/g, ', $1');
        // Semicolon-space: ensure space after semicolon
        // NOT before closing parens/brackets
        text = text.replace(/\s*;\s*/g, ' ; ');
        text = text.replace(/;\s*([^\s\]\)\}])/g, '; $1');
        // Colon: ensure proper spacing per ISBD
        // CRITICAL: Do NOT alter ratio colons (digit:digit) per ISBD 3.1.1.1
        text = text.replace(/\s*:\s*/g, ' : ');
        text = text.replace(/(\d)\s*:\s*(\d)/g, '$1:$2');
        text = text.replace(/\s*:\s*([\]\)\}])/g, ':$1');
        // Plus-space: ensure space around plus sign (ISBD prescribed punctuation)
        text = text.replace(/\s*\+\s*/g, ' + ');
        text = text.replace(/\s+\+([\]\)\}])/g, ' +$1');
        // Normalize multiple spaces to single space
        text = text.replace(/  +/g, ' ');
        // Preserve leading spaces that are part of prescribed punctuation prefixes.
        text = text.replace(/\s+$/g, '');
        return text;
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function stripPrefixes(value, prefixes) {
        if (!value || !Array.isArray(prefixes)) return value || '';
        let text = value;
        prefixes.forEach(prefix => {
            if (!prefix) return;
            const trimmed = String(prefix).trim();
            if (!trimmed) return;
            const regex = new RegExp(`^\\s*${escapeRegExp(trimmed)}\\s*`);
            if (regex.test(text)) {
                text = text.replace(regex, '');
            }
        });
        return text;
    }

    function fieldHasSubfield(field, code) {
        if (!field || !Array.isArray(field.subfields)) return false;
        return field.subfields.some(sub => sub && sub.code && String(sub.value || '').trim()
            && sub.code.toLowerCase() === code.toLowerCase());
    }

    function fieldHasSubfieldAfter(field, index, code) {
        if (!field || !Array.isArray(field.subfields)) return false;
        const wanted = String(code || '').toLowerCase();
        for (let i = index + 1; i < field.subfields.length; i++) {
            const sub = field.subfields[i];
            if (!sub || !sub.code || !String(sub.value || '').trim()) continue;
            if (sub.code.toLowerCase() === wanted) return true;
        }
        return false;
    }

    function fieldHasSubfieldBefore(field, index, code) {
        if (!field || !Array.isArray(field.subfields)) return false;
        const wanted = String(code || '').toLowerCase();
        for (let i = index - 1; i >= 0; i--) {
            const sub = field.subfields[i];
            if (!sub || !sub.code || !String(sub.value || '').trim()) continue;
            if (sub.code.toLowerCase() === wanted) return true;
        }
        return false;
    }

    function nextSubfieldCode(field, index) {
        if (!field || !Array.isArray(field.subfields)) return '';
        for (let i = index + 1; i < field.subfields.length; i++) {
            const sub = field.subfields[i];
            if (sub && sub.code && String(sub.value || '').trim()) return sub.code;
        }
        return '';
    }

    function previousSubfieldCode(field, index) {
        if (!field || !Array.isArray(field.subfields)) return '';
        for (let i = index - 1; i >= 0; i--) {
            const sub = field.subfields[i];
            if (sub && sub.code && String(sub.value || '').trim()) return sub.code;
        }
        return '';
    }

    function repeatPolicyAllows(field, subfield, index, policy) {
        const mode = policy || 'all';
        if (mode === 'all') return true;
        const code = (subfield.code || '').toLowerCase();
        const indices = (field.subfields || [])
            .map((sub, idx) => (sub && sub.code && sub.code.toLowerCase() === code ? idx : -1))
            .filter(idx => idx >= 0);
        if (!indices.length) return true;
        if (mode === 'first_only') return index === indices[0];
        if (mode === 'last_only') return index === indices[indices.length - 1];
        return true;
    }

    function ruleApplies(rule, field, subfield, index) {
        if (!rule) return false;
        if (!ruleMatches(rule, field.tag, subfield.code, field.ind1, field.ind2)) return false;
        if (Array.isArray(rule.requires_subfields)) {
            for (const code of rule.requires_subfields) {
                if (!fieldHasSubfield(field, code)) return false;
            }
        }
        if (Array.isArray(rule.forbids_subfields)) {
            for (const code of rule.forbids_subfields) {
                if (fieldHasSubfield(field, code)) return false;
            }
        }
        if (Array.isArray(rule.requires_following_subfields)) {
            for (const code of rule.requires_following_subfields) {
                if (!fieldHasSubfieldAfter(field, index, code)) return false;
            }
        }
        if (Array.isArray(rule.forbids_following_subfields)) {
            for (const code of rule.forbids_following_subfields) {
                if (fieldHasSubfieldAfter(field, index, code)) return false;
            }
        }
        if (Array.isArray(rule.requires_preceding_subfields)) {
            for (const code of rule.requires_preceding_subfields) {
                if (!fieldHasSubfieldBefore(field, index, code)) return false;
            }
        }
        if (Array.isArray(rule.forbids_preceding_subfields)) {
            for (const code of rule.forbids_preceding_subfields) {
                if (fieldHasSubfieldBefore(field, index, code)) return false;
            }
        }
        if (rule.next_subfield_is) {
            const allowed = Array.isArray(rule.next_subfield_is) ? rule.next_subfield_is : [rule.next_subfield_is];
            const next = nextSubfieldCode(field, index);
            if (!allowed.map(x => x.toLowerCase()).includes((next || '').toLowerCase())) return false;
        }
        if (rule.previous_subfield_is) {
            const allowed = Array.isArray(rule.previous_subfield_is) ? rule.previous_subfield_is : [rule.previous_subfield_is];
            const prev = previousSubfieldCode(field, index);
            if (!allowed.map(x => x.toLowerCase()).includes((prev || '').toLowerCase())) return false;
        }
        if (!repeatPolicyAllows(field, subfield, index, rule.repeat_policy)) return false;
        return true;
    }

    function expectedValue(check, field, subfield, index) {
        let value = subfield.value || '';
        if (check.replace_ellipses_with_dash) {
            value = value.replace(/\.\s*\.\s*\./g, '-');
            value = value.replace(/\.{3,}/g, '-');
        }
        if (check.replace_square_brackets_with_parentheses) {
            value = value.replace(/\[/g, '(').replace(/\]/g, ')');
        }
        if (Array.isArray(check.strip_prefixes)) {
            value = stripPrefixes(value, check.strip_prefixes);
        }
        if (Array.isArray(check.end_not_in)) {
            value = stripEndings(value, check.end_not_in);
        }
        if (check.case_mode) {
            value = applyCaseMode(value, check.case_mode);
        }
        let prefix = resolvePrefix(check, field, subfield, index);
        const suffixInfo = resolveSuffix(check, field, subfield.code, index);
        let suffix = suffixInfo.suffix;
        const condition = (suffixInfo.mode !== 'always' && Array.isArray(check.when_following_subfields))
            ? {
                type: 'conditional_suffix',
                mode: suffixInfo.mode,
                has_following: suffixInfo.hasFollowing,
                following_subfields: check.when_following_subfields.slice()
            }
            : null;
        const shouldTrimFollowing = suffixInfo.hasFollowing
            && suffixInfo.mode !== 'always'
            && check.trim_trailing_punct !== false;
        const trimmed = value.trim();
        if (check.parallel_prefix && trimmed.startsWith('=')) {
            prefix = check.parallel_prefix;
            value = value.replace(/^\s*=\s*/, '');
        }

        // PREFIX-SUFFIX INTERDEPENDENCE: Check if previous subfield already provides our prefix.
        // If the previous subfield's value ends with our prefix text, our prefix is redundant.
        if (prefix && typeof index === 'number' && index > 0 && field && Array.isArray(field.subfields)) {
            const prevSub = field.subfields[index - 1];
            const prevVal = (prevSub && prevSub.value) ? String(prevSub.value) : '';
            if (prevVal) {
                const prefixCore = prefix.replace(/^\s+/, '').replace(/\s+$/, '');
                if (prefixCore && prevVal.trim().endsWith(prefixCore)) {
                    if (!/=/.test(prefix)) prefix = '';
                }
            }
            // Also check: does the current value itself already start with the prefix?
            if (prefix) {
                const prefixCore = prefix.replace(/^\s+/, '').replace(/\s+$/, '');
                if (prefixCore && trimmed.startsWith(prefixCore)) {
                    prefix = '';
                }
            }
        }

        if (Array.isArray(check.end_in) && endsWithAny(value, check.end_in)) {
            suffix = '';
        }
        let expected = value.replace(/\s+$/, '');

        // PREFIX-SUFFIX INTERDEPENDENCE: Check if our suffix would conflict with next subfield's prefix.
        // If the next subfield's value already starts with our suffix text, skip our suffix.
        if (suffix && check.skip_suffix_if_next_has_prefix === true && typeof index === 'number' && field && Array.isArray(field.subfields)) {
            const nextSub = field.subfields[index + 1];
            const nextVal = (nextSub && nextSub.value) ? String(nextSub.value) : '';
            if (nextVal.trim()) {
                const suffixCore = suffix.replace(/^\s+/, '').replace(/\s+$/, '');
                if (suffixCore && nextVal.trim().startsWith(suffixCore)) {
                    suffix = '';
                }
            }
        }

        if (prefix) {
            const prefixTrim = prefix.replace(/^\s+/, '');
            const prefixCore = prefixTrim.replace(/\s+$/, '');
            if (!expected.startsWith(prefix)
                && (!prefixTrim || !expected.startsWith(prefixTrim))
                && (!prefixCore || !expected.startsWith(prefixCore))) {
                expected = prefix + expected;
            } else if (prefixTrim && expected.startsWith(prefixTrim) && !expected.startsWith(prefix)) {
                expected = expected.replace(prefixTrim, prefix);
            } else if (prefixCore && expected.startsWith(prefixCore) && !expected.startsWith(prefix)) {
                expected = expected.replace(prefixCore, prefix);
            }
        }
        let trimmedByFollowing = false;
        if (!suffix && shouldTrimFollowing) {
            const beforeTrim = expected;
            if (Array.isArray(check.end_not_in)) {
                expected = stripEndings(expected, check.end_not_in).replace(/\s+$/, '');
            }
            trimmedByFollowing = expected !== beforeTrim;
            if (trimmedByFollowing && condition) {
                condition.action = 'trim';
            }
        }
        let appliedSuffix = false;
        if (suffix) {
            const expectedTrim = expected.replace(/\s+$/, '');
            const suffixTrim = suffix.replace(/\s+$/, '');
            if (suffixTrim && expectedTrim.endsWith(suffixTrim)) {
                expected = expectedTrim;
                if (/\s$/.test(suffix) && !/\s$/.test(expected)) {
                    expected += ' ';
                }
                return { expected, condition };
            }
        }
        if (suffix && !expected.endsWith(suffix)) {
            let suffixToAdd = suffix;
            if (/^\s*\./.test(suffix) && /\.\s*$/.test(expected)) {
                suffixToAdd = suffix;
                expected = expected.replace(/\s+$/, '');
            } else if (check.trim_trailing_punct !== false) {
                expected = stripRedundantSuffixPunctuation(expected, suffix);
            }
            expected += suffixToAdd;
            appliedSuffix = true;
        }
        if (check.normalize_punctuation) {
            expected = normalizePunctuation(expected);
            if (suffix && /\+\s$/.test(suffix)) {
                const suffixTrim = suffix.replace(/\s+$/, '');
                if (suffixTrim && expected.endsWith(suffixTrim) && !/\s$/.test(expected)) {
                    expected += ' ';
                }
            }
        }
        if (condition && !condition.action && appliedSuffix) {
            condition.action = 'add';
        }
        return { expected, condition };
    }

    function applyCaseMode(value, mode) {
        const text = value || '';
        if (mode === 'lower') return text.toLowerCase();
        if (mode === 'sentence') return sentenceCase(text);
        if (mode === 'initial_upper') return initialUpper(text);
        if (mode === 'initial_lower') return initialLower(text);
        if (mode === 'title') return titleCase(text);
        return text;
    }

    function sentenceCase(text) {
        const lowered = (text || '').toLowerCase();
        return initialUpper(lowered);
    }

    function initialUpper(text) {
        const chars = text.split('');
        for (let i = 0; i < chars.length; i++) {
            if (/[A-Za-z]/.test(chars[i])) {
                chars[i] = chars[i].toUpperCase();
                break;
            }
        }
        return chars.join('');
    }

    function initialLower(text) {
        const chars = text.split('');
        for (let i = 0; i < chars.length; i++) {
            if (/[A-Za-z]/.test(chars[i])) {
                chars[i] = chars[i].toLowerCase();
                break;
            }
        }
        return chars.join('');
    }

    function titleCase(text) {
        return text.split(/\s+/).map(word => toTitleWord(word)).join(' ');
    }

    function toTitleWord(word) {
        if (!word) return word;
        const match = word.match(/^([("'\\[]*)([A-Za-z][A-Za-z'.-]*)([^A-Za-z]*)$/);
        if (!match) return word;
        const leading = match[1] || '';
        const core = match[2] || '';
        const trailing = match[3] || '';
        if (core.toUpperCase() === core && core.length <= 3) {
            return `${leading}${core}${trailing}`;
        }
        if (/^Mc[A-Za-z]/.test(core)) {
            const rest = core.slice(2);
            return `${leading}Mc${rest.charAt(0).toUpperCase()}${rest.slice(1).toLowerCase()}${trailing}`;
        }
        if (core.includes("'")) {
            const parts = core.split("'");
            const fixed = parts.map(part => part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : '').join("'");
            return `${leading}${fixed}${trailing}`;
        }
        return `${leading}${core.charAt(0).toUpperCase()}${core.slice(1).toLowerCase()}${trailing}`;
    }

    function applyCheck(rule, check, field, subfield, index) {
        const value = (subfield.value || '').toString();
        if (!value.trim()) return null;
        let expected = value;
        let condition = null;
        if (check.type === 'punctuation') {
            const result = expectedValue(check, field, subfield, index);
            expected = result.expected;
            condition = result.condition;
        } else if (check.type === 'separator') {
            const sep = check.separator || ' -- ';
            expected = expected.replace(/[.,;:!?]+\s*$/, '');
            if (!expected.endsWith(sep)) expected += sep;
            if (check.normalize_punctuation) expected = normalizePunctuation(expected);
        } else if (check.type === 'no_terminal_punctuation') {
            expected = expected.replace(/[.,;:!?]+\s*$/, '');
        } else if (check.type === 'spacing') {
            expected = expected.replace(/\s{2,}/g, ' ');
        } else if (check.type === 'normalize_punctuation') {
            if ((rule.id === 'ISBD_AREA_SEPARATOR_001' || rule.id === 'ISBD_DOUBLE_PUNCT_001')
                && !/\.\s*[\u2012\u2013\u2014-]/.test(expected)) {
                return null;
            }
            expected = normalizePunctuation(expected);
        } else if (check.type === 'fixed_field') {
            return null;
        }
        if (expected === value) return null;
        return {
            severity: check.severity || rule.severity || 'INFO',
            code: rule.id || 'ISBD_RULE',
            message: check.message || `ISBD punctuation issue in ${field.tag}$${subfield.code}`,
            rationale: rule.rationale || '',
            tag: field.tag,
            subfield: subfield.code,
            occurrence: normalizeOccurrence(field.occurrence),
            subfield_index: index,
            current_value: value,
            expected_value: expected,
            condition,
            examples: rule.examples || [],
            proposed_fixes: [{
                label: (rule.fixes && rule.fixes[0] && rule.fixes[0].label) || 'Apply ISBD punctuation',
                patch: [{
                    op: 'replace_subfield',
                    tag: field.tag,
                    code: subfield.code,
                    subfield: subfield.code,
                    occurrence: normalizeOccurrence(field.occurrence),
                    subfield_index: index,
                    value: expected
                }]
            }]
        };
    }

    function filterMatchedRules(rules) {
        if (rules.length <= 1) return rules;
        const filtered = rules.filter(rule => !rule.only_when_no_other_rule);
        const active = filtered.length ? filtered : rules;
        const maxScore = active.reduce((max, rule) => Math.max(max, ruleSpecificity(rule)), 0);
        return active.filter(rule => rule.always_apply || ruleSpecificity(rule) === maxScore);
    }

    function ruleSpecificity(rule) {
        if (!rule) return 0;
        let score = 0;
        if (rule.tag) score += 8;
        else if (rule.tag_pattern) score += 3;
        if (Array.isArray(rule.subfields)) score += 4;
        else if (rule.subfield_pattern) score += 1;
        if (rule.ind1 !== undefined && rule.ind1 !== null && rule.ind1 !== '') score += 2;
        if (rule.ind2 !== undefined && rule.ind2 !== null && rule.ind2 !== '') score += 2;
        if (Array.isArray(rule.requires_subfields) || Array.isArray(rule.forbids_subfields)) score += 1;
        if (Array.isArray(rule.requires_following_subfields) || Array.isArray(rule.forbids_following_subfields)) score += 1;
        if (Array.isArray(rule.requires_preceding_subfields) || Array.isArray(rule.forbids_preceding_subfields)) score += 1;
        return score;
    }

    function validateField(field, settings, rules) {
        const findings = [];
        const matchedRuleIds = new Set();
        field.subfields.forEach((sub, index) => {
            if (!sub || !sub.code) return;
            const matched = filterMatchedRules(rules.filter(rule => ruleApplies(rule, field, sub, index)));
            matched.forEach(rule => matchedRuleIds.add(rule.id));
            matched.forEach(rule => {
                (rule.checks || []).forEach(check => {
                    const finding = applyCheck(rule, check, field, sub, index);
                    if (finding) findings.push(finding);
                });
            });
        });
        return {
            findings,
            coverage: {
                covered: matchedRuleIds.size > 0,
                rule_ids: Array.from(matchedRuleIds)
            }
        };
    }

    function validateRecord(record, settings, rules, strictCoverage) {
        const findings = [];
        record.fields.forEach(field => {
            field.subfields.forEach((sub, index) => {
                const matched = filterMatchedRules(rules.filter(rule => ruleApplies(rule, field, sub, index)));
                if (!matched.length && strictCoverage) {
                    findings.push({
                        severity: 'INFO',
                        code: 'ISBD_COVERAGE_MISSING',
                        message: `No ISBD rule defined for ${field.tag}$${sub.code}; no punctuation assistance applied.`,
                        rationale: 'Strict coverage mode is enabled.',
                        tag: field.tag,
                        subfield: sub.code,
                        occurrence: normalizeOccurrence(field.occurrence),
                        proposed_fixes: []
                    });
                }
                matched.forEach(rule => {
                    (rule.checks || []).forEach(check => {
                        const finding = applyCheck(rule, check, field, sub, index);
                        if (finding) findings.push(finding);
                    });
                });
            });
        });
        return { findings };
    }

    function isFieldCovered(tag, subfield, ind1, ind2, rules) {
        return rules.some(rule => ruleMatches(rule, tag, subfield, ind1, ind2));
    }

    global.ISBDRulesEngine = {
        loadRules: normalizeRules,
        validateField,
        validateRecord,
        isFieldCovered,
        DEFAULT_RULES,
        getWarnings: () => Array.from(ruleWarnings),
        clearWarnings: () => ruleWarnings.clear(),
        onWarning: null
    };
})(window);
