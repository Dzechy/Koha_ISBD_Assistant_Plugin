const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const pack = JSON.parse(fs.readFileSync(path.join(root, 'Koha/Plugin/Cataloging/AutoPunctuation/rules/isbd_baseline.json'), 'utf8'));
const guide = JSON.parse(fs.readFileSync(path.join(root, 'Koha/Plugin/Cataloging/AutoPunctuation/rules/intern_guide_v2.json'), 'utf8'));
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 't/fixtures/isbd_punctuation_cases.json'), 'utf8'));

const ruleIds = new Set((pack.rules || []).map(rule => rule.id).filter(Boolean));
const fixtureNames = new Set(fixtures.map(fixture => fixture.name));

assert.strictEqual(guide.guide_version, '2.0.0', 'guide v2 version is explicit');
assert(Array.isArray(guide.modules) && guide.modules.length >= 3, 'guide has novice, practitioner, and reviewer modules');

guide.modules.forEach(module => {
  assert(module.id, 'module has id');
  assert(module.level, `${module.id} has level`);
  assert(Array.isArray(module.lessons), `${module.id} has lessons`);
  module.lessons.forEach(lesson => {
    ['why', 'how', 'common_mistake', 'do_not_automate'].forEach(key => {
      assert(lesson[key], `${module.id}/${lesson.id} includes ${key}`);
    });
    if (lesson.rule_id) {
      assert(ruleIds.has(lesson.rule_id), `${module.id}/${lesson.id} references existing rule ${lesson.rule_id}`);
    }
  });
  (module.examples || []).forEach(example => {
    if (example.fixture) {
      assert(fixtureNames.has(example.fixture), `${module.id} references fixture ${example.fixture}`);
    }
  });
});

console.log('guide_consistency: ok');
