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

const pack = JSON.parse(fs.readFileSync(path.join(root, 'Koha/Plugin/Cataloging/AutoPunctuation/rules/isbd_baseline.json'), 'utf8'));
const rules = context.window.ISBDRulesEngine.loadRules(pack, '{}');

function validate(field) {
  return context.window.ISBDRulesEngine.validateField({ ind1: '', ind2: '', occurrence: 0, ...field }, {}, rules).findings;
}

function assertFinding(field, subfield, value, name) {
  const findings = validate(field);
  assert(
    findings.some(f => f.subfield === subfield && f.expected_value === value),
    `${name}: expected ${field.tag}$${subfield} -> ${value}`
  );
}

const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
assert(readme.includes('245$b  : a novel'), 'README documents 245$b prefix-on-current convention');
assert(readme.includes('245$c  / F. Scott Fitzgerald.'), 'README documents 245$c slash prefix');
assert(!readme.includes('245$b a novel /'), 'README does not document slash suffix on 245$b');

assertFinding({
  tag: '245',
  subfields: [
    { code: 'a', value: 'The great Gatsby' },
    { code: 'b', value: 'a novel' },
    { code: 'c', value: 'F. Scott Fitzgerald' }
  ]
}, 'b', ' : a novel', 'README title example');
assertFinding({
  tag: '245',
  subfields: [
    { code: 'a', value: 'The great Gatsby' },
    { code: 'b', value: 'a novel' },
    { code: 'c', value: 'F. Scott Fitzgerald' }
  ]
}, 'c', ' / F. Scott Fitzgerald.', 'README title example');
assertFinding({
  tag: '300',
  subfields: [
    { code: 'a', value: 'xii, 180 pages' },
    { code: 'b', value: ': illustrations' },
    { code: 'c', value: '; 23 cm' }
  ]
}, 'b', 'illustrations ;', 'README physical example');

console.log('docs_examples: ok');
