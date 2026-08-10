#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_INPUT_BYTES = 32 * 1024;
const MAX_CANDIDATES = 3;

function loadPackage() {
    const candidates = [
        path.resolve(__dirname, '..', 'vendor', 'node_modules', 'lccs-2024'),
        'lccs-2024'
    ];
    let lastError;
    for (const candidate of candidates) {
        try {
            const api = require(candidate);
            const manifest = require(path.join(require.resolve(candidate), '..', '..', 'package.json'));
            return { api, manifest };
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('lccs-2024 is not installed');
}

function normalizeLetters(value) {
    const match = String(value || '').toUpperCase().match(/^([A-Z]{1,3})(?=\d)/);
    return match ? match[1] : '';
}

function scopeScore(scope, letters) {
    if (!scope || /_TABLES$/.test(scope)) return -1;
    let best = -1;
    for (const segment of scope.split('_')) {
        const range = segment.match(/^([A-Z]+)-([A-Z]+)$/);
        if (range) {
            if (letters >= range[1] && letters <= range[2]) {
                best = Math.max(best, (Math.min(range[1].length, range[2].length) * 20) + segment.length);
            }
            continue;
        }
        if (letters.startsWith(segment)) best = Math.max(best, segment.length * 20);
    }
    return best;
}

function candidateSchedules(api, letters) {
    return api.listSchedules()
        .map(schedule => ({ schedule, score: scopeScore(schedule.scope, letters) }))
        .filter(item => item.score >= 0)
        .sort((a, b) => b.score - a.score || a.schedule.scope.localeCompare(b.schedule.scope));
}

function pageCarriesClass(api, scope, pageNumber, letters) {
    const page = api.getPage(scope, pageNumber);
    if (!page || !Array.isArray(page.items)) return false;
    return page.items.some(item => {
        const text = String(item && (item.text_clean || item.text) || '').trim().toUpperCase();
        return text === letters;
    });
}

function verifyCandidate(api, value) {
    const candidate = String(value || '').trim().toUpperCase();
    const letters = normalizeLetters(candidate);
    if (!letters) return { candidate, status: 'invalid_candidate', matches: [] };

    const scheduleCode = candidate.slice(letters.length).replace(/\s+/g, ' ').trim();
    if (!scheduleCode) return { candidate, status: 'invalid_candidate', matches: [] };

    const matches = [];
    for (const item of candidateSchedules(api, letters)) {
        let entries;
        try {
            entries = api.findCodes(scheduleCode, { schedule: item.schedule.scope });
        } catch (_error) {
            continue;
        }
        for (const entry of entries.slice(0, 12)) {
            if (!pageCarriesClass(api, item.schedule.scope, entry.page, letters)) continue;
            matches.push({
                candidate,
                schedule_code: entry.code,
                caption: entry.caption_clean || entry.caption || '',
                notes: Array.isArray(entry.notes) ? entry.notes.slice(0, 3) : [],
                page: entry.page,
                scope: item.schedule.scope,
                schedule_title: entry.schedule && entry.schedule.title || item.schedule.title || '',
                source_pdf: entry.schedule && entry.schedule.source_pdf || item.schedule.source_pdf || ''
            });
        }
        if (matches.length) break;
    }
    return { candidate, status: matches.length ? 'verified' : 'no_match', matches };
}

function main() {
    const raw = fs.readFileSync(0);
    if (raw.length > MAX_INPUT_BYTES) throw new Error('input exceeds limit');
    const input = JSON.parse(raw.toString('utf8') || '{}');
    const { api, manifest } = loadPackage();
    const report = api.validationReport();
    const candidates = Array.isArray(input.candidates) ? input.candidates.slice(0, MAX_CANDIDATES) : [];
    const checks = candidates.map(value => verifyCandidate(api, value));
    process.stdout.write(JSON.stringify({
        available: true,
        source: `${manifest.name}@${manifest.version}`,
        validation: {
            status: report.status || report.validation_status || 'PASS',
            source_files: report.source_files || report.summary && report.summary.source_files || api.stats().source_files,
            total_pages: report.total_pages || report.summary && report.summary.total_pages || api.stats().total_pages,
            total_entries: report.total_entries || report.summary && report.summary.total_entries || api.stats().total_entries,
            minimum_similarity: api.stats().minimum_similarity
        },
        checks
    }));
}

try {
    main();
} catch (error) {
    process.stdout.write(JSON.stringify({ available: false, error: String(error && error.message || error) }));
    process.exitCode = 1;
}
