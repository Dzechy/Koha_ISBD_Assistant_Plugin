'use strict';

const assert = require('node:assert');
const childProcess = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const helper = path.join(root, 'Koha/Plugin/Cataloging/AutoPunctuation/scripts/lccs_evidence.js');
const uiSource = require('node:fs').readFileSync(
    path.join(root, 'Koha/Plugin/Cataloging/AutoPunctuation/js/marc_intellisense_ui.js'), 'utf8');

function query(candidates) {
    const run = childProcess.spawnSync(process.execPath, [helper], {
        cwd: root,
        input: JSON.stringify({ candidates }),
        encoding: 'utf8',
        timeout: 10000
    });
    assert.strictEqual(run.status, 0, run.stderr || run.stdout);
    return JSON.parse(run.stdout);
}

const result = query(['Z665', 'QA76.73.J38', 'ZZ999999']);
assert.strictEqual(result.available, true, 'published LCCS package is available');
assert.strictEqual(result.source, 'lccs-2024@1.1.0', 'exact package release supplies evidence');
assert.strictEqual(result.validation.status, 'PASS', 'source validation status is retained');
assert.strictEqual(result.validation.source_files, 44, 'all source schedules are represented');
assert.strictEqual(result.validation.total_pages, 18131, 'validated source page count is retained');

assert.strictEqual(result.checks[0].status, 'verified', 'Z665 is verified against schedule Z');
assert.strictEqual(result.checks[0].matches[0].caption, 'General works');
assert.strictEqual(result.checks[1].status, 'verified', 'QA number is resolved to its page-level subclass');
assert.strictEqual(result.checks[1].matches[0].caption, 'Java');
assert.strictEqual(result.checks[2].status, 'no_match', 'unknown code degrades without fabricated evidence');
assert.deepStrictEqual(result.checks[2].matches, []);
assert(uiSource.includes('LCCS 2024 schedule verified'), 'cataloging UI identifies exact LCCS verification');
assert(uiSource.includes('No exact LCCS schedule match'), 'cataloging UI labels non-gating verification misses');

console.log('lccs evidence regression tests passed');
