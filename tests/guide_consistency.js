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

assert.strictEqual(guide.schema_version, '4.2.0', 'training schema version is explicit');
assert.strictEqual(guide.guide_version, '4.2.0', 'training curriculum version is explicit');
assert(Array.isArray(guide.modules) && guide.modules.length === 11, 'curriculum has the complete eleven-module learning path');
assert.strictEqual(guide.modules.flatMap(module => module.lessons).length, 11, 'curriculum has exactly eleven substantial lessons');
assert(guide.modules.flatMap(module => module.lessons).flatMap(lesson => lesson.exercises).length >= 111,
  'curriculum has at least one hundred and eleven scored exercises');
assert(Array.isArray(guide.skills) && guide.skills.length >= 10, 'curriculum declares independently mastered skills');
assert(Array.isArray(guide.glossary) && guide.glossary.length >= 14, 'contextual glossary is data-driven');

const exerciseTypes = new Set();
const exerciseIds = new Set();
const skillIds = new Set(guide.skills.map(skill => skill.id));

guide.modules.forEach(module => {
  assert(module.id, 'module has id');
  assert(module.level, `${module.id} has level`);
  assert(Array.isArray(module.prerequisites), `${module.id} has prerequisites`);
  assert(Array.isArray(module.skills) && module.skills.length, `${module.id} assesses skills`);
  module.skills.forEach(skill => assert(skillIds.has(skill), `${module.id} references declared skill ${skill}`));
  assert(Array.isArray(module.lessons), `${module.id} has lessons`);
  assert.strictEqual(module.lessons.length, 1, `${module.id} has one comprehensive lesson`);
  module.lessons.forEach(lesson => {
    ['why', 'how', 'common_mistake', 'do_not_automate'].forEach(key => {
      assert(lesson[key], `${module.id}/${lesson.id} includes ${key}`);
    });
    assert(lesson.sections && lesson.sections.introduction && lesson.sections.why_it_matters
      && lesson.sections.learn && lesson.sections.see_it && lesson.sections.reflection,
    `${module.id}/${lesson.id} supports the complete lesson model`);
    assert(Array.isArray(lesson.exercises) && lesson.exercises.length >= 10, `${module.id}/${lesson.id} has at least ten meaningful assessments`);
    lesson.exercises.forEach((exercise, exerciseIndex) => {
      if (exerciseIndex > 0) {
        assert(Number(exercise.difficulty) >= Number(lesson.exercises[exerciseIndex - 1].difficulty),
          `${module.id}/${lesson.id}/${exercise.id} is ordered by non-decreasing difficulty`);
      }
    });
    lesson.exercises.forEach(exercise => {
      assert(exercise.id && !exerciseIds.has(exercise.id), `${module.id}/${lesson.id} has a unique exercise id`);
      exerciseIds.add(exercise.id);
      exerciseTypes.add(exercise.type);
      assert(skillIds.has(exercise.skill), `${exercise.id} assesses a declared skill`);
      assert(exercise.expected_answer !== undefined, `${exercise.id} declares an expected answer`);
      assert(Array.isArray(exercise.hints) && exercise.hints.length >= 2, `${exercise.id} has progressive hints`);
      assert(exercise.explanation, `${exercise.id} explains the answer`);
      assert(Number(exercise.difficulty) >= 1, `${exercise.id} declares difficulty`);
      if (exercise.referenced_rule) {
        assert(ruleIds.has(exercise.referenced_rule), `${exercise.id} references existing rule ${exercise.referenced_rule}`);
      }
    });
  });
  assert(module.assessment && Array.isArray(module.assessment.exercise_ids), `${module.id} defines a competency assessment`);
  module.assessment.exercise_ids.forEach(id => assert(exerciseIds.has(id), `${module.id} assessment references ${id}`));
});

['knowledge', 'recognition', 'application', 'field_builder', 'error_detection', 'reasoning', 'automation_judgment', 'cataloguer_judgment', 'record_construction']
  .forEach(type => assert(exerciseTypes.has(type), `curriculum supports ${type} questions`));

assert.strictEqual(guide.modules[guide.modules.length - 1].certification, true, 'final module is a competency certification');
const titleLab = guide.modules.find(module => module.id === 'title-responsibility').lessons[0].exercises
  .find(exercise => exercise.id === 'title-fix-245');
assert.strictEqual(titleLab.expected_answer.subfields[0].value, 'The great Gatsby', 'training preserves prefix-on-current title boundary convention');
assert(/^:\s/.test(titleLab.expected_answer.subfields[1].value), 'training stores the colon prefix on 245$b');
assert(/^\/\s/.test(titleLab.expected_answer.subfields[2].value), 'training stores the responsibility slash prefix on 245$c');

console.log('guide_consistency: ok');
