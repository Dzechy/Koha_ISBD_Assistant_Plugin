/*
 * This file is part of Koha.
 *
 * Copyright (C) 2025  Duke Chijimaka Jonathan
 *
 * Koha is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 3 of the License, or
 * (at your option) any later version.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

function permutations(items) {
  if (items.length < 2) return [items.slice()];
  const out = [];
  items.forEach((item, index) => {
    const rest = items.slice(0, index).concat(items.slice(index + 1));
    permutations(rest).forEach(permutation => out.push([item].concat(permutation)));
  });
  return out;
}

function semanticValueSignature(field) {
  const normalized = engine.normalizeField(field, {}, rules).field;
  const counts = {};
  const values = {};
  normalized.subfields.forEach(sub => {
    const occurrence = counts[sub.code] || 0;
    counts[sub.code] = occurrence + 1;
    values[`${sub.code}@${occurrence}`] = sub.value;
  });
  return JSON.stringify(Object.keys(values).sort().map(key => [key, values[key]]));
}

function semanticFindingSignature(field) {
  const counts = {};
  const identities = (field.subfields || []).map(sub => {
    const occurrence = counts[sub.code] || 0;
    counts[sub.code] = occurrence + 1;
    return `${sub.code}@${occurrence}`;
  });
  return JSON.stringify(engine.validateField(field, {}, rules).findings
    .map(finding => [
      identities[finding.subfield_index],
      finding.code,
      finding.severity,
      finding.expected_value
    ])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
}

function assertPermutationInvariant(field, message) {
  const variants = permutations(field.subfields);
  const expectedSignature = semanticValueSignature(field);
  const expectedRender = engine.renderField(field, {}, rules);
  const expectedFindings = semanticFindingSignature(field);
  variants.forEach(subfields => {
    const candidate = { ...field, subfields };
    assert.strictEqual(semanticValueSignature(candidate), expectedSignature, `${message}: values`);
    assert.strictEqual(engine.renderField(candidate, {}, rules), expectedRender, `${message}: rendering`);
    assert.strictEqual(semanticFindingSignature(candidate), expectedFindings, `${message}: guardrails`);
  });
}

const titleValues = {
  a: 'The Great Gatsby',
  b: 'A Novel',
  c: 'F. Scott Fitzgerald',
  n: 'Part 1',
  p: 'Poems'
};
[
  ['a'],
  ['a', 'b'],
  ['a', 'c'],
  ['a', 'b', 'c'],
  ['a', 'n'],
  ['a', 'p'],
  ['a', 'n', 'p'],
  ['a', 'b', 'n'],
  ['a', 'b', 'p'],
  ['a', 'n', 'p', 'c'],
  ['a', 'b', 'n', 'p', 'c']
].forEach(codes => {
  assertPermutationInvariant({
    tag: '245',
    subfields: codes.map(code => ({ code, value: titleValues[code] }))
  }, `245 ${codes.join('')}`);
});

assert.strictEqual(engine.renderField({
  tag: '245',
  subfields: [
    { code: 'b', value: 'a novel.' },
    { code: 'c', value: 'F. Scott Fitzgerald' },
    { code: 'a', value: 'The Great Gatsby' }
  ]
}, {}, rules), 'The Great Gatsby : a novel / F. Scott Fitzgerald.', 'plain terminal period is removed from 245$b before $c');

assert.strictEqual(engine.renderField({
  tag: '245',
  subfields: [
    { code: 'a', value: 'Title' },
    {
      code: 'b',
      value: 'Version Dr.',
      punctuation_provenance: { source: 'intrinsic', value: 'Version Dr.', generated_suffix: '' }
    },
    { code: 'c', value: 'Author' }
  ]
}, {}, rules), 'Title : Version Dr. / Author.', 'intrinsic/abbreviation period is preserved before 245$c');

const generatedSubtitle = engine.normalizeField({
  tag: '245',
  subfields: [{ code: 'b', value: 'a novel' }]
}, {}, rules).field.subfields[0];
assert.strictEqual(generatedSubtitle.value, 'a novel.', 'field-final 245$b receives a generated period');
assert.strictEqual(generatedSubtitle.punctuation_provenance.source, 'plugin', 'generated punctuation records its source');
assert.strictEqual(generatedSubtitle.punctuation_provenance.generated_suffix, '.', 'generated suffix is recorded');
assert.strictEqual(engine.renderField({
  tag: '245',
  subfields: [
    generatedSubtitle,
    { code: 'c', value: 'Author' }
  ]
}, {}, rules), 'a novel / Author.', 'a later related 245$c removes the plugin-generated 245$b period');

assertPermutationInvariant({
  tag: '250',
  subfields: [
    { code: 'a', value: '2nd ed.' },
    { code: 'b', value: 'revised' }
  ]
}, '250 a+b');
assert.strictEqual(engine.renderField({
  tag: '250',
  subfields: [
    { code: 'b', value: 'revised' },
    { code: 'a', value: '2nd ed.' }
  ]
}, {}, rules), '2nd ed., revised.', '250 boundary punctuation uses semantic order');
assert.strictEqual(engine.renderField({
  tag: '250',
  subfields: [
    { code: 'b', value: '= 2e édition' },
    { code: 'a', value: '2nd ed.' }
  ]
}, {}, rules), '2nd ed. = 2e édition.', '250 parallel-edition delimiter is resolved semantically');

['260', '264'].forEach(tag => {
  assertPermutationInvariant({
    tag,
    ind2: tag === '264' ? '1' : '',
    subfields: [
      { code: 'a', value: 'London' },
      { code: 'b', value: 'Penguin' },
      { code: 'c', value: '2020' }
    ]
  }, `${tag} a+b+c`);
});
assert.strictEqual(engine.renderField({
  tag: '264',
  ind2: '1',
  subfields: [
    { code: 'c', value: '2020' },
    { code: 'b', value: 'Penguin' },
    { code: 'a', value: 'London' }
  ]
}, {}, rules), 'London : Penguin, 2020.', '264 renders semantically');

const repeatedPlaces = engine.normalizeField({
  tag: '260',
  subfields: [
    { code: 'c', value: '1925' },
    { code: 'a', value: 'New York' },
    { code: 'a', value: 'Chicago' }
  ]
}, {}, rules).field;
assert.deepStrictEqual(
  repeatedPlaces.subfields.filter(sub => sub.code === 'a').map(sub => sub.value),
  ['New York ;', 'Chicago,'],
  'repeated publication places preserve occurrence order and receive distinct boundaries'
);

assertPermutationInvariant({
  tag: '300',
  subfields: [
    { code: 'a', value: '250 pages' },
    { code: 'b', value: 'illustrations' },
    { code: 'c', value: '24 cm' },
    { code: 'e', value: '1 booklet' }
  ]
}, '300 a+b+c+e');
assert.strictEqual(engine.renderField({
  tag: '300',
  subfields: [
    { code: 'e', value: '1 booklet' },
    { code: 'c', value: '24 cm' },
    { code: 'b', value: 'illustrations' },
    { code: 'a', value: '250 pages' }
  ]
}, {}, rules), '250 pages : illustrations ; 24 cm + 1 booklet', '300 renders without manufactured final period');

const repeatedExtents = engine.semanticSubfields(engine.normalizeField({
  tag: '300',
  subfields: [
    { code: 'c', value: '24 cm' },
    { code: 'a', value: '1 volume' },
    { code: 'a', value: '1 atlas' }
  ]
}, {}, rules).field, rules);
assert.deepStrictEqual(
  repeatedExtents.filter(sub => sub.code === 'a').map(sub => sub.value),
  ['1 volume', '1 atlas ;'],
  'repeated 300$a values retain their meaningful occurrence order and only the last gets the next-element boundary'
);

assertPermutationInvariant({
  tag: '490',
  subfields: [
    { code: 'a', value: 'Series title' },
    { code: 'x', value: '1234-5678' },
    { code: 'v', value: 'volume 3' }
  ]
}, '490 a+x+v');
assert.strictEqual(engine.renderField({
  tag: '490',
  subfields: [
    { code: 'v', value: 'volume 3' },
    { code: 'a', value: 'Series title' }
  ]
}, {}, rules), 'Series title ; volume 3', '490 has no manufactured final period');

assert.strictEqual(engine.validateField({
  tag: '246',
  ind1: '3',
  subfields: [{ code: 'a', value: 'Variant title' }]
}, {}, rules).findings.length, 0, '246 does not receive manufactured terminal punctuation');

assertPermutationInvariant({
  tag: '255',
  subfields: [
    { code: 'a', value: 'Scale 1:25000' },
    { code: 'b', value: 'Conic proj.' },
    { code: 'c', value: '(W 10°--W 5°/N 8°--N 2°)' }
  ]
}, '255 a+b+c');
assert.strictEqual(engine.renderField({
  tag: '255',
  subfields: [
    { code: 'c', value: '(W 10°--W 5°/N 8°--N 2°)' },
    { code: 'b', value: 'Conic proj.' },
    { code: 'a', value: 'Scale 1:25000' }
  ]
}, {}, rules), 'Scale 1:25000 ; Conic proj. (W 10°--W 5°/N 8°--N 2°).', '255 terminal punctuation belongs to the final semantic element');

const edgeField = {
  tag: '245',
  subfields: [
    { code: 'c', value: '  J. R. R. Tolkien  ' },
    { code: 'b', value: '  a study (revised edition)  ' },
    { code: 'a', value: 'What...' },
    { code: 'p', value: '' }
  ]
};
const edgeRender = engine.renderField(edgeField, {}, rules);
assert(edgeRender.includes('What...'), 'ellipses are preserved');
assert(edgeRender.includes('J. R. R. Tolkien.'), 'initials are preserved');
assert(!edgeRender.includes('.. /'), 'responsibility punctuation is not duplicated');

assert.strictEqual(engine.renderField({
  tag: '245',
  subfields: [
    { code: 'a', value: '' },
    { code: 'b', value: 'Subtitle' }
  ]
}, {}, rules), 'Subtitle.', 'an empty related value is treated as absent');
assert.strictEqual(engine.renderField({
  tag: '245',
  subfields: [
    { code: 'b', value: ' Subtitle ' },
    { code: 'a', value: 'Title ' }
  ]
}, {}, rules), 'Title : Subtitle.', 'outer whitespace is normalized at presentation boundaries');
assert.strictEqual(engine.renderField({
  tag: '245',
  subfields: [
    { code: 'c', value: '/ John Smith ; Jane Doe' },
    { code: 'a', value: '"The book"' }
  ]
}, {}, rules), '"The book" / John Smith ; Jane Doe.', 'quoted titles and multiple responsibility statements are preserved');
assert.strictEqual(engine.renderField({
  tag: '245',
  subfields: [
    { code: 'a', value: 'Memoirs' },
    { code: 'c', value: 'John Smith, Jr.' }
  ]
}, {}, rules), 'Memoirs / John Smith, Jr.', 'an existing abbreviation point is not duplicated');
assert.strictEqual(engine.renderField({
  tag: '246',
  ind1: '3',
  subfields: [{ code: 'a', value: 'Variant title.' }]
}, {}, rules), 'Variant title.', '246 preserves data-dependent existing punctuation');

const original = {
  tag: '245',
  ind1: '1',
  ind2: '4',
  occurrence: 2,
  subfields: [
    { code: 'c', value: 'Author' },
    { code: 'b', value: 'Subtitle' },
    { code: 'a', value: 'Title' }
  ]
};
const first = engine.normalizeField(original, {}, rules).field;
const second = engine.normalizeField(first, {}, rules).field;
assert.strictEqual(JSON.stringify(second), JSON.stringify(first), 'field normalization is idempotent');
assert.deepStrictEqual(first.subfields.map(sub => sub.code), original.subfields.map(sub => sub.code), 'physical MARC subfield order is preserved');
assert.strictEqual(first.ind1, original.ind1, 'first indicator is preserved');
assert.strictEqual(first.ind2, original.ind2, 'second indicator is preserved');
assert.strictEqual(first.occurrence, original.occurrence, 'field occurrence is preserved');

const record = {
  fields: [
    original,
    {
      tag: '300',
      occurrence: 0,
      subfields: [
        { code: 'c', value: '24 cm' },
        { code: 'a', value: '250 pages' }
      ]
    }
  ]
};
const saved = engine.normalizeRecord(record, {}, rules).record;
const serialized = engine.serializeRecord(saved);
assert(serialized.fields.every(field => field.subfields.every(sub => !sub.punctuation_provenance)), 'serialized MARC excludes internal punctuation provenance');
const reloaded = JSON.parse(JSON.stringify(serialized));
const savedAgain = engine.serializeRecord(engine.normalizeRecord(reloaded, {}, rules).record);
assert.strictEqual(JSON.stringify(savedAgain), JSON.stringify(serialized), 'save/reload normalization does not duplicate punctuation');

console.log('semantic_relationship_regression: ok');
