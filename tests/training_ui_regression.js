'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.join(
    __dirname, '..', 'Koha/Plugin/Cataloging/AutoPunctuation/js/marc_intellisense_ui_training.js'
), 'utf8');

assert(source.includes('data-lesson-id='), 'the learning path exposes functional lesson selection');
assert(source.includes('engine.lessonStatus('), 'lesson controls reflect prerequisite state');
assert(source.includes('engine.lessonRequirements('), 'completion readiness is based on assessed practice');
assert(source.includes('function bindAnswerDraft('), 'unsubmitted practice drafts survive exercise navigation');
assert(source.includes('const next = engine.nextLesson('), 'completion advances to the next required lesson');
assert(source.includes("kind: 'explanation'"), 'rule explanations use neutral feedback instead of a false incorrect state');
assert(source.includes('grid-template-rows:minmax(0,1fr)') && source.includes('scrollbar-gutter:stable'),
    'the training workspace uses bounded independent scrollers');
assert(source.includes('.isbd-training-level,.isbd-training-skill') && source.includes('border-radius:4px'),
    'training badges use consistent restrained corners');

console.log('training_ui_regression: ok');
