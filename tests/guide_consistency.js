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
