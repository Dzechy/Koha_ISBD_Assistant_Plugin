/* Regression coverage for the data-driven training and competency model. */
const assert = require('assert');
const engine = require('../Koha/Plugin/Cataloging/AutoPunctuation/js/training_engine.js');
const curriculum = require('../Koha/Plugin/Cataloging/AutoPunctuation/rules/intern_guide_v2.json');

const firstModule = curriculum.modules[0];
const secondModule = curriculum.modules[1];
const firstLesson = firstModule.lessons[0];

let progress = engine.createProgress(curriculum, {}, 1000);
assert.strictEqual(engine.onboardingScreen(progress), 0, 'new trainee starts in onboarding');
assert.strictEqual(progress.onboarding.completed, false, 'onboarding is not pre-completed');
engine.advanceOnboarding(curriculum, progress, {}, 1100);
engine.advanceOnboarding(curriculum, progress, {}, 1200);
engine.advanceOnboarding(curriculum, progress, { experience: 'basic_marc' }, 1300);
assert.strictEqual(progress.onboarding.experience, 'basic_marc', 'experience selection persists');
engine.advanceOnboarding(curriculum, progress, { complete: true }, 1400);
assert.strictEqual(progress.onboarding.completed, true, 'four-step onboarding completes explicitly');

assert.strictEqual(engine.moduleStatus(curriculum, progress, firstModule.id), 'not_started', 'first module is available');
assert.strictEqual(engine.moduleStatus(curriculum, progress, secondModule.id), 'locked', 'prerequisite module is locked');
assert.strictEqual(engine.selectLesson(curriculum, progress, secondModule.id, secondModule.lessons[0].id).reason, 'prerequisite_locked', 'locked lesson cannot be selected');
engine.setAdvancedMode(progress, true, 1500);
assert.notStrictEqual(engine.moduleStatus(curriculum, progress, secondModule.id), 'locked', 'explicit advanced mode unlocks navigation');
assert.notStrictEqual((progress.module_progress[secondModule.id] || {}).status, 'mastered', 'advanced mode does not award mastery');
engine.setAdvancedMode(progress, false, 1600);

const foundationKnowledge = firstLesson.exercises[0];
const foundationJudgment = firstLesson.exercises[1];
const foundationChallenge = firstLesson.exercises[2];
const wrong = engine.recordExerciseAttempt(curriculum, progress, foundationKnowledge.id, 'The plugin configuration', {}, 1700);
assert.strictEqual(wrong.result.correct, false, 'incorrect answer fails');
assert.strictEqual(progress.mistakes['cataloguing-foundations'], 1, 'failed exercise is recorded by skill');
engine.recordExerciseAttempt(curriculum, progress, foundationKnowledge.id, 'The plugin configuration', {}, 1800);
assert(progress.review_recommendations.some(item => item.skill === 'cataloguing-foundations'), 'recurring mistakes trigger targeted review');

const hint1 = engine.nextHint(progress, foundationKnowledge, 1900);
const hint2 = engine.nextHint(progress, foundationKnowledge, 2000);
assert.strictEqual(hint1.index, 1, 'first progressive hint is returned first');
assert.strictEqual(hint2.index, 2, 'second progressive hint follows');
assert.notStrictEqual(hint1.hint, hint2.hint, 'progressive hints teach in stages');

const revealed = engine.revealAnswer(progress, foundationKnowledge, 2100);
assert.strictEqual(revealed.answer, foundationKnowledge.expected_answer, 'show answer returns the declared model answer');
engine.recordExerciseAttempt(curriculum, progress, foundationKnowledge.id, foundationKnowledge.expected_answer, {}, 2200);
assert.strictEqual(engine.calculateSkillMastery(curriculum, progress, 'cataloguing-foundations').status, 'needs_review', 'revealed answer does not award mastery');
engine.resetExerciseAssistance(progress, foundationKnowledge.id, 2300);
engine.recordExerciseAttempt(curriculum, progress, foundationKnowledge.id, foundationKnowledge.expected_answer, {}, 2400);
engine.recordExerciseAttempt(curriculum, progress, foundationJudgment.id, foundationJudgment.expected_answer, {}, 2500);
engine.recordExerciseAttempt(curriculum, progress, foundationKnowledge.id, foundationKnowledge.expected_answer, {}, 2510);
engine.recordExerciseAttempt(curriculum, progress, foundationJudgment.id, foundationJudgment.expected_answer, {}, 2520);
engine.recordExerciseAttempt(curriculum, progress, foundationKnowledge.id, foundationKnowledge.expected_answer, {}, 2530);
engine.recordExerciseAttempt(curriculum, progress, foundationChallenge.id, foundationChallenge.expected_answer, {}, 2540);
assert.strictEqual(engine.calculateSkillMastery(curriculum, progress, 'cataloguing-foundations').status, 'mastered', 'meaningful independent demonstrations award skill mastery');

firstLesson.exercises.slice(3).forEach((exercise, exerciseOffset) => {
    engine.recordExerciseAttempt(curriculum, progress, exercise.id, engine.clone(exercise.expected_answer), {}, 2550 + exerciseOffset);
});

const completion = engine.completeLesson(curriculum, progress, firstLesson.id, 2600);
assert.strictEqual(completion.ok, true, 'lesson completes after required successful practice');
assert.strictEqual(engine.lessonRequirements(curriculum, progress, firstLesson.id).completed, true, 'lesson reports functional completion readiness after all exercises');
assert.strictEqual(engine.moduleStatus(curriculum, progress, firstModule.id), 'mastered', 'module mastery combines the comprehensive lesson, skill, and assessment evidence');
assert.notStrictEqual(engine.moduleStatus(curriculum, progress, secondModule.id), 'locked', 'mastering the complete prerequisite unlocks the next module');

const activityCount = progress.recent_activity.length;
assert.strictEqual(engine.selectLesson(curriculum, progress, firstModule.id, firstLesson.id, 2700).ok, true, 'completed lesson can be revisited');
assert.strictEqual(progress.lesson_progress[firstLesson.id].status, 'completed', 'revisiting does not corrupt completion');
assert(progress.recent_activity.length >= activityCount, 'revisit activity remains bounded and valid');

const fieldExercise = secondModule.lessons[0].exercises.find(item => item.type === 'field_builder');
assert.strictEqual(engine.evaluateExercise(fieldExercise, fieldExercise.expected_answer).correct, true, 'MARC field builder validates tag, indicators, subfields, order, and punctuation');
const changedIndicator = engine.clone(fieldExercise.expected_answer);
changedIndicator.ind2 = '1';
assert.strictEqual(engine.evaluateExercise(fieldExercise, changedIndicator).correct, false, 'incorrect indicator fails field construction');

const errorExercise = curriculum.modules.find(module => module.id === 'title-responsibility').lessons[0].exercises.find(item => item.type === 'error_detection');
assert.strictEqual(engine.evaluateExercise(errorExercise, errorExercise.expected_answer).correct, true, 'multi-select error detection accepts the exact problem set');
assert.strictEqual(engine.evaluateExercise(errorExercise, [errorExercise.expected_answer[0]]).correct, false, 'partial error detection does not pass');

const serialized = JSON.parse(JSON.stringify(progress));
const restored = engine.createProgress(curriculum, serialized, 2800);
assert.strictEqual(restored.lesson_progress[firstLesson.id].status, 'completed', 'progress persists through JSON storage');
assert.strictEqual(restored.skill_mastery['cataloguing-foundations'].status, 'mastered', 'mastery persists and recalculates consistently');

const changedCurriculum = engine.clone(curriculum);
changedCurriculum.guide_version = '3.1.0';
const invalidated = engine.createProgress(changedCurriculum, serialized, 2900);
assert(invalidated.requires_review.includes(firstModule.id), 'version change preserves completion but marks completed work for review');
assert.strictEqual(engine.moduleStatus(changedCurriculum, invalidated, firstModule.id), 'review_required', 'version review is distinct from incomplete work');

const premature = engine.createProgress(curriculum, {}, 3000);
premature.lesson_progress[firstLesson.id] = { status: 'completed' };
engine.refreshProgress(curriculum, premature, 3100);
assert.notStrictEqual(premature.module_progress[firstModule.id].status, 'mastered', 'click-through completion without assessment cannot create mastery');

function completeCourseIndependently() {
    const state = engine.createProgress(curriculum, {}, 4000);
    state.onboarding.completed = true;
    let clock = 4100;
    curriculum.modules.forEach(module => {
        module.lessons.forEach(lesson => {
            const opened = engine.selectLesson(curriculum, state, module.id, lesson.id, clock++);
            assert.strictEqual(opened.ok, true, `${module.id} unlocks in sequence`);
            (lesson.exercises || []).concat(lesson.questions || []).forEach(exercise => {
                engine.recordExerciseAttempt(curriculum, state, exercise.id, engine.clone(exercise.expected_answer), {}, clock++);
                engine.recordExerciseAttempt(curriculum, state, exercise.id, engine.clone(exercise.expected_answer), {}, clock++);
            });
            assert.strictEqual(engine.completeLesson(curriculum, state, lesson.id, clock++).ok, true, `${lesson.id} completes with independent practice`);
        });
        assert.strictEqual(state.module_progress[module.id].status, 'mastered', `${module.id} reaches evidence-based mastery`);
    });
    return state;
}

const graduate = completeCourseIndependently();
assert.strictEqual(graduate.assessment_results.final.status, 'passed', 'final competency assessment certifies an independently mastered course');
assert.strictEqual(graduate.assessment_results.final.score, 100, 'final assessment score is persisted');
const supervisor = engine.supervisorSummary(curriculum, graduate);
assert.strictEqual(supervisor.completion_percent, 100, 'supervisor sees course completion');
assert.strictEqual(supervisor.mastery_percentage, 100, 'supervisor sees mastery separately');
assert.strictEqual(supervisor.assessment_status, 'passed', 'supervisor sees assessment status');
assert(supervisor.exercise_attempts >= 48, 'supervisor sees exercise attempts');

const assisted = engine.createProgress(curriculum, graduate, 5000);
const finalModule = curriculum.modules[curriculum.modules.length - 1];
const finalExercise = finalModule.lessons[0].exercises[0];
engine.nextHint(assisted, finalExercise, 5100);
engine.recordExerciseAttempt(curriculum, assisted, finalExercise.id, engine.clone(finalExercise.expected_answer), {}, 5200);
assert.strictEqual(assisted.module_progress[finalModule.id].assessment_score, 100, 'a later assisted retry does not replace earlier independent assessment evidence');

console.log('training_engine_regression: ok');
