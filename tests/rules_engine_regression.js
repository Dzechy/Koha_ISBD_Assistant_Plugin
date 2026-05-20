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

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const context = { window: {}, console };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(root, 'Koha/Plugin/Cataloging/AutoPunctuation/js/rules_engine.js'), 'utf8'),
  context
);

const pack = JSON.parse(
  fs.readFileSync(path.join(root, 'Koha/Plugin/Cataloging/AutoPunctuation/rules/isbd_baseline.json'), 'utf8')
);
const engine = context.window.ISBDRulesEngine;
const rules = engine.loadRules(pack, '{}');

function validate(field) {
  return engine.validateField({ ind1: '', ind2: '', occurrence: 0, ...field }, {}, rules).findings;
}

function expectedMap(findings) {
  const out = new Map();
  findings.forEach(f => out.set(`${f.tag}$${f.subfield}@${f.subfield_index}`, f.expected_value));
  return out;
}

function assertExpected(field, expected) {
  const map = expectedMap(validate(field));
  Object.entries(expected).forEach(([key, value]) => {
    assert.strictEqual(map.get(key), value, `${key} expected value`);
  });
}

function assertNoFinding(field, key) {
  const map = expectedMap(validate(field));
  assert.strictEqual(map.has(key), false, `${key} should not produce a finding`);
}

function assertFindingCount(field, predicate, count, message) {
  const findings = validate(field).filter(predicate);
  assert.strictEqual(findings.length, count, message);
}

function assertNoSeverity(field, severity, message) {
  assertFindingCount(field, finding => finding.severity === severity, 0, message);
}

function assertNoFindingForCode(field, key, message) {
  assertNoFinding(field, key);
  assertNoSeverity(field, 'ERROR', message || `${key} should not produce ERROR findings`);
}

const sharedFixtures = JSON.parse(
  fs.readFileSync(path.join(root, 't/fixtures/isbd_punctuation_cases.json'), 'utf8')
);

sharedFixtures.forEach(testCase => {
  const findings = validate(testCase.field);
  testCase.expected.forEach(expected => {
    const matches = findings.filter(f => f.subfield === expected.subfield);
    assert(
      matches.some(f => f.expected_value === expected.value),
      `${testCase.name}: ${testCase.field.tag}$${expected.subfield} expected ${expected.value}`
    );
  });
});

assertExpected({
  tag: '245',
  subfields: [
    { code: 'a', value: 'The great gatsby' },
    { code: 'c', value: 'by Fitzgerald' }
  ]
}, { '245$c@1': ' / by Fitzgerald.' });
assertNoFinding({
  tag: '245',
  subfields: [
    { code: 'a', value: 'The great gatsby' },
    { code: 'c', value: 'by Fitzgerald' }
  ]
}, '245$a@0');

assertExpected({
  tag: '245',
  subfields: [
    { code: 'a', value: 'The great gatsby' },
    { code: 'b', value: 'a novel' },
    { code: 'c', value: 'by Fitzgerald' }
  ]
}, {
  '245$b@1': ' : a novel',
  '245$c@2': ' / by Fitzgerald.'
});

assertExpected({
  tag: '245',
  subfields: [
    { code: 'a', value: 'Collected works' },
    { code: 'p', value: 'Poems' },
    { code: 'c', value: 'edited by Smith' }
  ]
}, { '245$p@1': '. Poems', '245$c@2': ' / edited by Smith.' });
assertNoFinding({
  tag: '245',
  subfields: [
    { code: 'a', value: 'Collected works' },
    { code: 'p', value: '. Poems' },
    { code: 'c', value: 'edited by Smith' }
  ]
}, '245$p@1');

assertExpected({
  tag: '245',
  subfields: [{ code: 'b', value: ': a novel' }]
}, { '245$b@0': 'a novel.' });
assertNoSeverity({
  tag: '245',
  subfields: [{ code: 'b', value: ': a novel' }]
}, 'ERROR', '245$b-only sparse title is not an error');

assertExpected({
  tag: '245',
  subfields: [{ code: 'c', value: '/ by Fitzgerald' }]
}, { '245$c@0': 'by Fitzgerald.' });
assertExpected({
  tag: '245',
  subfields: [{ code: 'n', value: '. Part 1' }]
}, { '245$n@0': 'Part 1.' });
assertExpected({
  tag: '245',
  subfields: [{ code: 'p', value: ', Poems' }]
}, { '245$p@0': 'Poems.' });

assertExpected({
  tag: '245',
  subfields: [
    { code: 'b', value: 'a novel' },
    { code: 'c', value: 'by Fitzgerald' }
  ]
}, { '245$c@1': ' / by Fitzgerald.' });

assertExpected({
  tag: '245',
  subfields: [
    { code: 'n', value: 'Part 1' },
    { code: 'p', value: 'Poems' }
  ]
}, { '245$p@1': ', Poems.' });
assertNoFinding({
  tag: '245',
  subfields: [
    { code: 'n', value: 'Part 1' },
    { code: 'p', value: 'Poems' }
  ]
}, '245$n@0');

assertExpected({
  tag: '300',
  subfields: [
    { code: 'a', value: 'xii, 180 pages' },
    { code: 'b', value: ': illustrations' },
    { code: 'c', value: '; 23 cm' }
  ]
}, {
  '300$a@0': 'xii, 180 pages :',
  '300$b@1': 'illustrations ;',
  '300$c@2': '23 cm.'
});

assertExpected({
  tag: '300',
  subfields: [
    { code: 'a', value: 'xii, 180 pages' },
    { code: 'c', value: '23 cm' }
  ]
}, { '300$a@0': 'xii, 180 pages ;', '300$c@1': '23 cm.' });

assertExpected({
  tag: '300',
  subfields: [{ code: 'a', value: 'xii pages :' }]
}, { '300$a@0': 'xii pages.' });
assertExpected({
  tag: '300',
  subfields: [{ code: 'a', value: '180 pages ;' }]
}, { '300$a@0': '180 pages.' });
assertExpected({
  tag: '300',
  subfields: [{ code: 'a', value: 'xii, 180 pages :' }]
}, { '300$a@0': 'xii, 180 pages.' });
assertExpected({
  tag: '300',
  subfields: [{ code: 'b', value: ': illustrations' }]
}, { '300$b@0': 'illustrations.' });
assertExpected({
  tag: '300',
  subfields: [{ code: 'c', value: '; 23 cm' }]
}, { '300$c@0': '23 cm.' });
assertExpected({
  tag: '300',
  subfields: [{ code: 'e', value: '+ 1 booklet' }]
}, { '300$e@0': '1 booklet.' });
assertExpected({
  tag: '300',
  subfields: [
    { code: 'b', value: 'illustrations' },
    { code: 'e', value: '1 booklet' }
  ]
}, { '300$b@0': 'illustrations + ', '300$e@1': '1 booklet.' });
assertExpected({
  tag: '300',
  subfields: [
    { code: 'c', value: '23 cm' },
    { code: 'e', value: '1 booklet' }
  ]
}, { '300$c@0': '23 cm + ', '300$e@1': '1 booklet.' });
assertNoSeverity({
  tag: '300',
  subfields: [
    { code: 'b', value: ': illustrations' },
    { code: 'c', value: '; 23 cm' },
    { code: 'e', value: '+ 1 booklet' }
  ]
}, 'ERROR', 'sparse 300 imported punctuation is warning-safe');

assertExpected({
  tag: '260',
  subfields: [
    { code: 'a', value: 'New York' },
    { code: 'c', value: '1925' }
  ]
}, { '260$a@0': 'New York,', '260$c@1': '1925.' });

assertExpected({
  tag: '260',
  subfields: [
    { code: 'a', value: 'New York' },
    { code: 'a', value: 'Chicago' },
    { code: 'c', value: '1925' }
  ]
}, { '260$a@0': 'New York,', '260$a@1': ' ; Chicago,' });

assertExpected({
  tag: '260',
  subfields: [{ code: 'b', value: ': Scribner' }]
}, { '260$b@0': 'Scribner.' });
assertExpected({
  tag: '260',
  subfields: [{ code: 'c', value: ', 1925' }]
}, { '260$c@0': '1925.' });
assertExpected({
  tag: '260',
  subfields: [
    { code: 'a', value: 'New York' },
    { code: 'c', value: '1925' }
  ]
}, { '260$a@0': 'New York,', '260$c@1': '1925.' });
assertExpected({
  tag: '264',
  subfields: [
    { code: 'a', value: 'London' },
    { code: 'a', value: 'New York' },
    { code: 'c', value: '2020' }
  ]
}, { '264$a@0': 'London,', '264$a@1': ' ; New York,' });
assertNoSeverity({
  tag: '260',
  subfields: [
    { code: 'b', value: ': Vendor publisher' },
    { code: 'c', value: ', 1999' }
  ]
}, 'ERROR', 'sparse 260 vendor records should not hard-block');

assertNoFindingForCode({
  tag: '245',
  subfields: [
    { code: 'a', value: 'Sparse title' },
    { code: 'b', value: '   ' },
    { code: 'c', value: 'by Someone' }
  ]
}, '245$b@1', 'blank subfields are absent for validation');

assertExpected({
  tag: '490',
  subfields: [
    { code: 'a', value: 'Library of America' },
    { code: 'v', value: '1' },
    { code: 'v', value: '2' }
  ]
}, { '490$a@0': 'Library of America ;', '490$v@1': '1.', '490$v@2': '2.' });

assertExpected({
  tag: '490',
  subfields: [{ code: 'x', value: '0080-2258.' }]
}, { '490$x@0': '0080-2258' });

assertExpected({
  tag: '255',
  subfields: [{ code: 'a', value: 'Scale 1:25000' }]
}, { '255$a@0': 'Scale 1:25000.' });

assertNoSeverity({
  tag: '255',
  subfields: [{ code: 'c', value: '(W 131°--W 59°/N 53°--N 38°)' }]
}, 'ERROR', '255 coordinate subfields are handoff guardrails');

assertExpected({
  tag: '250',
  subfields: [{ code: 'a', value: '3rd ed.' }]
}, {});

assertExpected({
  tag: '250',
  subfields: [
    { code: 'a', value: '2nd ed.' },
    { code: 'b', value: 'revised' }
  ]
}, { '250$b@1': 'revised.' });

assertExpected({
  tag: '254',
  subfields: [{ code: 'a', value: 'Full score' }]
}, { '254$a@0': 'Full score.' });

assertExpected({
  tag: '362',
  subfields: [{ code: 'a', value: 'Vol. 1, no. 1 (Jan. 1971)-vol. 5, no. 12 (Dec. 1975)' }]
}, { '362$a@0': 'Vol. 1, no. 1 (Jan. 1971)-vol. 5, no. 12 (Dec. 1975).' });
assertNoFinding({
  tag: '362',
  subfields: [{ code: 'a', value: 'Vol. 1, no. 1 (Jan. 1971)-' }]
}, '362$a@0');

assertExpected({
  tag: '264',
  ind2: '4',
  subfields: [{ code: 'c', value: '©2020' }]
}, { '264$c@0': '©2020.' });
assertNoSeverity({
  tag: '264',
  ind2: '4',
  subfields: [
    { code: 'a', value: 'Place' },
    { code: 'b', value: 'Name' }
  ]
}, 'ERROR', '264 second indicator 4 copyright a/b subfields are handoff guardrails');
assertNoFinding({
  tag: '264',
  ind2: '4',
  subfields: [
    { code: 'a', value: 'Place' },
    { code: 'b', value: 'Name' }
  ]
}, '264$a@0');
assertNoFinding({
  tag: '264',
  ind2: '4',
  subfields: [
    { code: 'a', value: 'Place' },
    { code: 'b', value: 'Name' }
  ]
}, '264$b@1');

assertFindingCount({
  tag: '020',
  subfields: [{ code: 'a', value: '978-3-16-148410-0.' }]
}, finding => finding.code === 'ISBD_ISBN_020', 1, '020$a should use the specific ISBN rule once');
assertFindingCount({
  tag: '020',
  subfields: [{ code: 'a', value: '978-3-16-148410-0.' }]
}, finding => finding.code === 'ISBD_STDNUM_NO_PUNCT_001', 0, '020$a should not also emit the generic standard-number rule');

assertFindingCount({
  tag: '024',
  subfields: [{ code: 'a', value: '123456789.' }]
}, finding => finding.code === 'ISBD_STDNUM_NO_PUNCT_001', 1, '024$a should still use the generic standard-number rule');

assertExpected({
  tag: '022',
  subfields: [{ code: 'a', value: '0024-2667.' }]
}, { '022$a@0': '0024-2667' });

assertExpected({
  tag: '028',
  subfields: [{ code: 'a', value: 'ABC-123.' }]
}, { '028$a@0': 'ABC-123' });

assertFindingCount({
  tag: '500',
  subfields: [{ code: 'a', value: 'Includes index' }]
}, finding => finding.code === 'ISBD_NOTES_500A_001', 1, '500$a should use the specific note rule once');
assertFindingCount({
  tag: '500',
  subfields: [{ code: 'a', value: 'Includes index' }]
}, finding => finding.code === 'ISBD_OTHER_ED_NOTE_500' || finding.code === 'ISBD_NOTES_GENERAL_5XX_A', 0, '500$a should not emit generic fallback note rules');

assertExpected({
  tag: '504',
  subfields: [{ code: 'a', value: 'Includes bibliographical references' }]
}, { '504$a@0': 'Includes bibliographical references.' });

assertExpected({
  tag: '520',
  subfields: [{ code: 'a', value: 'A story of love and loss' }]
}, { '520$a@0': 'A story of love and loss.' });

assertNoSeverity({
  tag: '336',
  subfields: [{ code: 'a', value: 'text.' }]
}, 'ERROR', '336 content type is a handoff guardrail');
assertNoSeverity({
  tag: '337',
  subfields: [{ code: 'a', value: 'unmediated.' }]
}, 'ERROR', '337 media type is a handoff guardrail');
assertNoSeverity({
  tag: '338',
  subfields: [{ code: 'a', value: 'volume.' }]
}, 'ERROR', '338 carrier type is a handoff guardrail');
assertNoSeverity({
  tag: '830',
  subfields: [{ code: 'a', value: 'Library of America ; 1' }]
}, 'ERROR', '8XX series tracing fields are handoff guardrails');
assertNoSeverity({
  tag: '856',
  subfields: [{ code: 'u', value: 'https://example.org/resource?id=1.' }]
}, 'ERROR', '856 URL fields are handoff guardrails');

console.log('rules_engine_regression: ok');
