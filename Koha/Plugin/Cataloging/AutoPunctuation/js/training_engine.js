/*
 * Data-driven training, mastery, and progress model for the Koha ISBD Assistant.
 * The module is deliberately independent of the DOM so the same competency
 * rules can be exercised in Node regression tests and the Koha staff client.
 */
(function(root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ISBDTrainingEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
    'use strict';

    const ENGINE_VERSION = '1.0.0';

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function asObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function asArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function clamp(value, minimum, maximum) {
        const number = Number(value);
        if (!Number.isFinite(number)) return minimum;
        return Math.min(maximum, Math.max(minimum, number));
    }

    function timestamp(now) {
        if (typeof now === 'number' && Number.isFinite(now)) return Math.floor(now);
        return Date.now();
    }

    function normalizeText(value) {
        return String(value === undefined || value === null ? '' : value)
            .normalize('NFKC')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeLooseText(value) {
        return normalizeText(value).toLocaleLowerCase();
    }

    function canonicalField(value) {
        const field = asObject(value);
        return {
            tag: normalizeText(field.tag),
            ind1: String(field.ind1 === undefined ? ' ' : field.ind1).slice(0, 1),
            ind2: String(field.ind2 === undefined ? ' ' : field.ind2).slice(0, 1),
            subfields: asArray(field.subfields).map(subfield => ({
                code: String(asObject(subfield).code || '').slice(0, 1),
                value: normalizeText(asObject(subfield).value)
            }))
        };
    }

    function canonicalAnswer(value, exercise) {
        const type = normalizeText(asObject(exercise).type);
        if (type === 'field_builder' || type === 'record_construction') {
            return JSON.stringify(canonicalField(value));
        }
        if (type === 'error_detection' || type === 'multi_select') {
            return asArray(value).map(normalizeLooseText).filter(Boolean).sort();
        }
        return normalizeLooseText(value);
    }

    function courseObject(curriculum) {
        const root = asObject(curriculum);
        return asObject(root.course).id ? root.course : root;
    }

    function modules(curriculum) {
        const root = asObject(curriculum);
        const course = courseObject(root);
        return asArray(course.modules).length ? asArray(course.modules) : asArray(root.modules);
    }

    function skillCatalog(curriculum) {
        const root = asObject(curriculum);
        const course = courseObject(root);
        return asArray(course.skills).length ? asArray(course.skills) : asArray(root.skills);
    }

    function curriculumVersions(curriculum) {
        const root = asObject(curriculum);
        const course = courseObject(root);
        return {
            course_version: normalizeText(course.version || root.course_version || '1.0.0'),
            guide_version: normalizeText(root.guide_version || course.guide_version || '1.0.0'),
            rules_version: normalizeText(root.rules_version || course.rules_version || '1.0.0')
        };
    }

    function indexCurriculum(curriculum) {
        const index = {
            modules: {}, lessons: {}, exercises: {}, exerciseLocations: {}, skills: {}
        };
        skillCatalog(curriculum).forEach(skill => {
            if (skill && skill.id) index.skills[skill.id] = skill;
        });
        modules(curriculum).forEach(module => {
            if (!module || !module.id) return;
            index.modules[module.id] = module;
            asArray(module.lessons).forEach(lesson => {
                if (!lesson || !lesson.id) return;
                index.lessons[lesson.id] = lesson;
                asArray(lesson.exercises).concat(asArray(lesson.questions)).forEach(exercise => {
                    if (!exercise || !exercise.id) return;
                    index.exercises[exercise.id] = exercise;
                    index.exerciseLocations[exercise.id] = { module_id: module.id, lesson_id: lesson.id };
                });
            });
            const assessment = asObject(module.assessment);
            asArray(assessment.exercises).forEach(exercise => {
                if (!exercise || !exercise.id) return;
                index.exercises[exercise.id] = exercise;
                index.exerciseLocations[exercise.id] = { module_id: module.id, lesson_id: '', assessment: true };
            });
        });
        return index;
    }

    function baseProgress(curriculum, now) {
        const versions = curriculumVersions(curriculum);
        const firstModule = modules(curriculum)[0] || {};
        const firstLesson = asArray(firstModule.lessons)[0] || {};
        return {
            engine_version: ENGINE_VERSION,
            ...versions,
            onboarding: { completed: false, screen: 0, experience: '', recommended_module: firstModule.id || '' },
            current_module: firstModule.id || '',
            current_lesson: firstLesson.id || '',
            current_step: 'introduction',
            module_progress: {},
            lesson_progress: {},
            exercise_attempts: {},
            quiz_results: {},
            hint_usage: {},
            revealed_answers: {},
            skill_mastery: {},
            mistakes: {},
            review_recommendations: [],
            requires_review: [],
            assessment_results: {},
            recent_activity: [],
            last_activity: timestamp(now),
            advanced_mode: false
        };
    }

    function addActivity(progress, activity, now) {
        const item = {
            at: timestamp(now),
            type: normalizeText(activity.type || 'activity'),
            module_id: normalizeText(activity.module_id),
            lesson_id: normalizeText(activity.lesson_id),
            exercise_id: normalizeText(activity.exercise_id),
            detail: normalizeText(activity.detail).slice(0, 240)
        };
        progress.recent_activity = [item].concat(asArray(progress.recent_activity)).slice(0, 20);
        progress.last_activity = item.at;
    }

    function createProgress(curriculum, stored, now) {
        const progress = baseProgress(curriculum, now);
        const source = asObject(stored);
        const versions = curriculumVersions(curriculum);
        const oldVersions = {
            course_version: normalizeText(source.course_version),
            guide_version: normalizeText(source.guide_version),
            rules_version: normalizeText(source.rules_version)
        };
        const versionChanged = !!(source.engine_version || source.course_version || source.guide_version || source.rules_version) && Object.keys(versions)
            .some(key => oldVersions[key] && oldVersions[key] !== versions[key]);

        [
            'onboarding', 'module_progress', 'lesson_progress', 'exercise_attempts',
            'quiz_results', 'hint_usage', 'revealed_answers', 'skill_mastery',
            'mistakes', 'assessment_results'
        ].forEach(key => {
            if (!(key in source)) return;
            progress[key] = key === 'onboarding'
                ? { ...progress.onboarding, ...clone(asObject(source[key])) }
                : clone(asObject(source[key]));
        });
        progress.review_recommendations = clone(asArray(source.review_recommendations));
        progress.requires_review = clone(asArray(source.requires_review));
        progress.recent_activity = clone(asArray(source.recent_activity)).slice(0, 20);
        progress.current_module = normalizeText(source.current_module) || progress.current_module;
        progress.current_lesson = normalizeText(source.current_lesson) || progress.current_lesson;
        progress.current_step = normalizeText(source.current_step) || progress.current_step;
        progress.advanced_mode = source.advanced_mode === true;
        progress.last_activity = Number(source.last_activity) || progress.last_activity;
        progress.engine_version = ENGINE_VERSION;
        Object.assign(progress, versions);

        if (versionChanged) {
            progress.requires_review = modules(curriculum)
                .filter(module => asObject(progress.module_progress[module.id]).status === 'completed'
                    || asObject(progress.module_progress[module.id]).status === 'mastered')
                .map(module => module.id);
            Object.keys(progress.module_progress).forEach(moduleId => {
                if (progress.requires_review.includes(moduleId)) {
                    progress.module_progress[moduleId].requires_review = true;
                }
            });
            progress.review_recommendations.unshift({
                type: 'version_change',
                skill: '',
                module_id: progress.requires_review[0] || '',
                message: 'Completed work is preserved, but the curriculum or rules changed and requires review.'
            });
            addActivity(progress, { type: 'version_review', detail: 'Curriculum or rules version changed.' }, now);
        }
        return refreshProgress(curriculum, progress, now);
    }

    function onboardingScreen(progress) {
        const onboarding = asObject(progress.onboarding);
        return onboarding.completed ? 4 : clamp(onboarding.screen, 0, 3);
    }

    function advanceOnboarding(curriculum, progress, values, now) {
        const input = asObject(values);
        progress.onboarding = asObject(progress.onboarding);
        if (input.experience !== undefined) {
            const allowed = ['new', 'basic_marc', 'some_experience', 'experienced'];
            progress.onboarding.experience = allowed.includes(input.experience) ? input.experience : 'new';
            const recommendationMap = {
                new: modules(curriculum)[0],
                basic_marc: modules(curriculum)[1] || modules(curriculum)[0],
                some_experience: modules(curriculum)[2] || modules(curriculum)[0],
                experienced: modules(curriculum)[0]
            };
            progress.onboarding.recommended_module = asObject(recommendationMap[progress.onboarding.experience]).id || '';
        }
        const current = onboardingScreen(progress);
        progress.onboarding.screen = Math.min(3, current + 1);
        if (input.complete || current >= 3) {
            progress.onboarding.completed = true;
            progress.onboarding.screen = 4;
            const recommendation = progress.onboarding.recommended_module;
            if (recommendation && progress.advanced_mode) progress.current_module = recommendation;
        }
        addActivity(progress, { type: progress.onboarding.completed ? 'onboarding_completed' : 'onboarding_progress' }, now);
        return progress;
    }

    function setAdvancedMode(progress, enabled, now) {
        progress.advanced_mode = enabled === true;
        addActivity(progress, { type: 'advanced_mode', detail: progress.advanced_mode ? 'Enabled' : 'Disabled' }, now);
        return progress;
    }

    function lessonExerciseIds(lesson) {
        return asArray(lesson && lesson.exercises).concat(asArray(lesson && lesson.questions))
            .filter(exercise => exercise && exercise.id && exercise.required !== false)
            .map(exercise => exercise.id);
    }

    function hasEligibleCorrectAttempt(progress, exerciseId) {
        return asArray(asObject(progress.exercise_attempts)[exerciseId])
            .some(attempt => attempt && attempt.correct && !attempt.answer_revealed);
    }

    function completeLesson(curriculum, progress, lessonId, now) {
        const index = indexCurriculum(curriculum);
        const lesson = index.lessons[lessonId];
        if (!lesson) return { ok: false, reason: 'lesson_not_found', progress };
        const required = lessonExerciseIds(lesson);
        const missing = required.filter(id => !hasEligibleCorrectAttempt(progress, id));
        if (missing.length) return { ok: false, reason: 'required_practice', missing, progress };
        progress.lesson_progress[lessonId] = {
            ...asObject(progress.lesson_progress[lessonId]),
            status: 'completed', completed_at: timestamp(now)
        };
        const location = Object.values(index.exerciseLocations).find(item => item.lesson_id === lessonId) || {};
        addActivity(progress, { type: 'lesson_completed', module_id: location.module_id, lesson_id: lessonId }, now);
        refreshProgress(curriculum, progress, now);
        return { ok: true, progress };
    }

    function moduleStatus(curriculum, progress, moduleId, advancedMode) {
        const index = indexCurriculum(curriculum);
        const module = index.modules[moduleId];
        if (!module) return 'missing';
        const bypass = advancedMode === true || progress.advanced_mode === true;
        const locked = !bypass && asArray(module.prerequisites || module.depends_on)
            .some(dependency => asObject(progress.module_progress[dependency]).status !== 'mastered');
        if (locked) return 'locked';
        const stored = asObject(progress.module_progress[moduleId]);
        if (stored.requires_review || asArray(progress.requires_review).includes(moduleId)) return 'review_required';
        return stored.status || 'not_started';
    }

    function selectLesson(curriculum, progress, moduleId, lessonId, now) {
        const index = indexCurriculum(curriculum);
        if (!index.modules[moduleId] || !index.lessons[lessonId]) return { ok: false, reason: 'not_found', progress };
        if (moduleStatus(curriculum, progress, moduleId) === 'locked') return { ok: false, reason: 'prerequisite_locked', progress };
        if (!asArray(index.modules[moduleId].lessons).some(lesson => lesson.id === lessonId)) {
            return { ok: false, reason: 'lesson_not_in_module', progress };
        }
        progress.current_module = moduleId;
        progress.current_lesson = lessonId;
        progress.current_step = 'introduction';
        const existingModule = asObject(progress.module_progress[moduleId]);
        progress.module_progress[moduleId] = {
            ...existingModule,
            status: ['completed', 'mastered'].includes(existingModule.status) ? existingModule.status : 'in_progress',
            started_at: existingModule.started_at || timestamp(now)
        };
        progress.lesson_progress[lessonId] = {
            ...asObject(progress.lesson_progress[lessonId]), status: asObject(progress.lesson_progress[lessonId]).status || 'in_progress', last_viewed_at: timestamp(now)
        };
        addActivity(progress, { type: 'lesson_opened', module_id: moduleId, lesson_id: lessonId }, now);
        return { ok: true, progress };
    }

    function answerCandidates(exercise) {
        const candidates = [];
        if (exercise.expected_answer !== undefined) candidates.push(exercise.expected_answer);
        asArray(exercise.acceptable_alternatives).forEach(value => candidates.push(value));
        return candidates;
    }

    function evaluateExercise(exercise, answer) {
        const item = asObject(exercise);
        const actual = canonicalAnswer(answer, item);
        const candidates = answerCandidates(item).map(value => canonicalAnswer(value, item));
        let score = 0;
        if (Array.isArray(actual)) {
            const expected = Array.isArray(candidates[0]) ? candidates[0] : [];
            const expectedSet = new Set(expected);
            const actualSet = new Set(actual);
            const correctSelections = actual.filter(value => expectedSet.has(value)).length;
            const incorrectSelections = actual.filter(value => !expectedSet.has(value)).length;
            score = expected.length ? Math.max(0, (correctSelections - incorrectSelections) / expected.length) : 0;
            if (actualSet.size === expectedSet.size && actual.every(value => expectedSet.has(value))) score = 1;
        } else {
            score = candidates.some(candidate => candidate === actual) ? 1 : 0;
        }
        const threshold = clamp(asObject(item.scoring).passing_score === undefined ? 1 : item.scoring.passing_score, 0, 1);
        return {
            correct: score >= threshold,
            score,
            feedback: score >= threshold ? normalizeText(item.correct_feedback || 'Correct. Your answer demonstrates the intended relationship.')
                : normalizeText(item.incorrect_feedback || 'Not yet. Recheck the relationships and try again.'),
            explanation: normalizeText(item.explanation),
            referenced_rule: normalizeText(item.referenced_rule),
            referenced_concept: normalizeText(item.referenced_concept)
        };
    }

    function nextHint(progress, exercise, now) {
        const item = asObject(exercise);
        const hints = asArray(item.hints);
        const used = clamp(asObject(progress.hint_usage)[item.id] || 0, 0, hints.length);
        if (!hints.length) return { hint: '', index: 0, exhausted: true, progress };
        const index = Math.min(used, hints.length - 1);
        progress.hint_usage[item.id] = Math.min(hints.length, used + 1);
        addActivity(progress, { type: 'hint_used', exercise_id: item.id, detail: `Hint ${index + 1}` }, now);
        return { hint: normalizeText(hints[index]), index: index + 1, exhausted: index >= hints.length - 1, progress };
    }

    function revealAnswer(progress, exercise, now) {
        const item = asObject(exercise);
        progress.revealed_answers[item.id] = true;
        addActivity(progress, { type: 'answer_revealed', exercise_id: item.id }, now);
        return { answer: clone(item.expected_answer), explanation: normalizeText(item.explanation), progress };
    }

    function resetExerciseAssistance(progress, exerciseId, now) {
        delete progress.hint_usage[exerciseId];
        delete progress.revealed_answers[exerciseId];
        addActivity(progress, { type: 'exercise_reset', exercise_id: exerciseId }, now);
        return progress;
    }

    function skillDefinition(curriculum, skillId) {
        return indexCurriculum(curriculum).skills[skillId] || { id: skillId, title: skillId };
    }

    function calculateSkillMastery(curriculum, progress, skillId) {
        const index = indexCurriculum(curriculum);
        const definition = skillDefinition(curriculum, skillId);
        const attempts = [];
        Object.keys(index.exercises).forEach(exerciseId => {
            const exercise = index.exercises[exerciseId];
            if (exercise.skill !== skillId) return;
            asArray(progress.exercise_attempts[exerciseId]).forEach(attempt => {
                if (!attempt.answer_revealed) attempts.push({ ...attempt, difficulty: Number(exercise.difficulty) || 1 });
            });
        });
        attempts.sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
        const recent = attempts.slice(-5);
        const score = recent.length ? recent.reduce((sum, attempt) => sum + Number(attempt.score || 0), 0) / recent.length : 0;
        const required = Math.max(1, Number(definition.required_demonstrations || 2));
        const threshold = clamp(definition.mastery_threshold === undefined
            ? asObject(courseObject(curriculum)).mastery_threshold || 0.85
            : definition.mastery_threshold, 0, 1);
        const minimumDifficulty = Math.max(1, Number(definition.minimum_difficulty || 3));
        const mastered = recent.length >= required && score >= threshold
            && recent.some(attempt => attempt.correct && attempt.difficulty >= minimumDifficulty);
        return {
            skill_id: skillId,
            title: normalizeText(definition.title || skillId),
            status: mastered ? 'mastered' : (recent.length ? (score < 0.6 ? 'needs_review' : 'practicing') : 'not_started'),
            score: Math.round(score * 100),
            demonstrations: recent.length,
            required_demonstrations: required,
            last_practiced_at: recent.length ? recent[recent.length - 1].at : 0
        };
    }

    function refreshSkillMastery(curriculum, progress) {
        const ids = new Set(skillCatalog(curriculum).map(skill => skill.id).filter(Boolean));
        const index = indexCurriculum(curriculum);
        Object.keys(index.exercises).forEach(id => {
            if (index.exercises[id].skill) ids.add(index.exercises[id].skill);
        });
        ids.forEach(id => {
            progress.skill_mastery[id] = calculateSkillMastery(curriculum, progress, id);
        });
    }

    function assessmentScore(progress, assessment) {
        const policy = asObject(assessment);
        const ids = asArray(policy.exercise_ids);
        if (!ids.length) return null;
        const scores = ids.map(id => {
            const eligible = asArray(progress.exercise_attempts[id]).filter(attempt =>
                !attempt.answer_revealed
                && !(policy.hints_disqualify_attempt && Number(attempt.hints_used || 0) > 0)
            );
            return eligible.length ? Number(eligible[eligible.length - 1].score || 0) : 0;
        });
        return scores.reduce((sum, value) => sum + value, 0) / scores.length;
    }

    function refreshModules(curriculum, progress, now) {
        modules(curriculum).forEach(module => {
            const existing = asObject(progress.module_progress[module.id]);
            const lessons = asArray(module.lessons);
            const completedLessons = lessons.filter(lesson => asObject(progress.lesson_progress[lesson.id]).status === 'completed').length;
            const completion = lessons.length ? completedLessons / lessons.length : 0;
            const relevantSkills = Array.from(new Set(asArray(module.skills)
                .concat(lessons.flatMap(lesson => asArray(lesson.skills)))
                .filter(Boolean)));
            const skillsMastered = relevantSkills.length > 0
                && relevantSkills.every(skill => asObject(progress.skill_mastery[skill]).status === 'mastered');
            const score = assessmentScore(progress, module.assessment);
            const threshold = clamp(asObject(module.assessment).mastery_threshold === undefined
                ? module.mastery_threshold || asObject(courseObject(curriculum)).mastery_threshold || 0.85
                : module.assessment.mastery_threshold, 0, 1);
            const assessmentPassed = score === null ? true : score >= threshold;
            let status = existing.status || 'not_started';
            if (completion > 0 && status === 'not_started') status = 'in_progress';
            if (completion >= 1) status = 'completed';
            if (completion >= 1 && skillsMastered && assessmentPassed) status = 'mastered';
            const requiresReview = asArray(progress.requires_review).includes(module.id);
            progress.module_progress[module.id] = {
                ...existing,
                status,
                completion_percent: Math.round(completion * 100),
                mastery_percent: relevantSkills.length
                    ? Math.round((relevantSkills.filter(skill => asObject(progress.skill_mastery[skill]).status === 'mastered').length / relevantSkills.length) * 100)
                    : 0,
                assessment_score: score === null ? null : Math.round(score * 100),
                requires_review: requiresReview,
                mastered_at: status === 'mastered' ? existing.mastered_at || timestamp(now) : 0
            };
        });
    }

    function refreshRecommendations(curriculum, progress) {
        const triggerDefault = Number(asObject(courseObject(curriculum)).review_trigger || 2);
        const recommendations = asArray(progress.review_recommendations)
            .filter(item => asObject(item).type === 'version_change');
        Object.keys(progress.mistakes).forEach(skillId => {
            const definition = skillDefinition(curriculum, skillId);
            const count = Number(progress.mistakes[skillId] || 0);
            const trigger = Number(definition.review_trigger || triggerDefault || 2);
            if (count >= trigger && asObject(progress.skill_mastery[skillId]).status !== 'mastered') {
                recommendations.push({
                    type: 'weak_skill', skill: skillId, module_id: normalizeText(definition.module_id),
                    message: `You have missed ${count} exercises involving ${definition.title || skillId}. Review this skill before continuing.`
                });
            }
        });
        progress.review_recommendations = recommendations.slice(0, 20);
    }

    function refreshProgress(curriculum, progress, now) {
        refreshSkillMastery(curriculum, progress);
        refreshModules(curriculum, progress, now);
        refreshRecommendations(curriculum, progress);
        return progress;
    }

    function recordExerciseAttempt(curriculum, progress, exerciseId, answer, options, now) {
        const index = indexCurriculum(curriculum);
        const exercise = index.exercises[exerciseId];
        if (!exercise) return { ok: false, reason: 'exercise_not_found', progress };
        const location = index.exerciseLocations[exerciseId] || {};
        const moduleState = moduleStatus(curriculum, progress, location.module_id);
        if (moduleState === 'locked') return { ok: false, reason: 'prerequisite_locked', progress };
        const result = evaluateExercise(exercise, answer);
        const attempt = {
            at: timestamp(now), score: result.score, correct: result.correct,
            hints_used: Number(progress.hint_usage[exerciseId] || 0),
            answer_revealed: progress.revealed_answers[exerciseId] === true,
            difficulty: Number(exercise.difficulty || 1),
            answer: clone(answer)
        };
        progress.exercise_attempts[exerciseId] = asArray(progress.exercise_attempts[exerciseId]).concat([attempt]).slice(-20);
        if (exercise.type === 'knowledge' || exercise.type === 'recognition' || exercise.type === 'reasoning'
            || exercise.type === 'automation_judgment' || exercise.type === 'cataloguer_judgment') {
            progress.quiz_results[exerciseId] = { ...attempt };
        }
        if (!result.correct && exercise.skill) {
            progress.mistakes[exercise.skill] = Number(progress.mistakes[exercise.skill] || 0) + 1;
        }
        addActivity(progress, {
            type: result.correct ? 'exercise_correct' : 'exercise_failed',
            module_id: location.module_id, lesson_id: location.lesson_id, exercise_id: exerciseId,
            detail: result.correct ? 'Correct' : 'Needs review'
        }, now);
        refreshProgress(curriculum, progress, now);
        const module = index.modules[location.module_id];
        if (module && module.certification) {
            const score = assessmentScore(progress, module.assessment);
            const passed = score !== null && score >= clamp(asObject(module.assessment).mastery_threshold || 0.85, 0, 1)
                && modules(curriculum).filter(item => item.id !== module.id)
                    .every(item => asObject(progress.module_progress[item.id]).status === 'mastered');
            progress.assessment_results.final = {
                status: passed ? 'passed' : 'in_progress',
                score: score === null ? 0 : Math.round(score * 100),
                completed_at: passed ? timestamp(now) : 0
            };
        }
        return { ok: true, result, attempt, progress };
    }

    function weakSkills(curriculum, progress) {
        return Object.keys(progress.skill_mastery)
            .map(id => progress.skill_mastery[id])
            .filter(skill => skill.status === 'needs_review')
            .sort((a, b) => a.score - b.score);
    }

    function strongestSkills(progress) {
        return Object.keys(progress.skill_mastery)
            .map(id => progress.skill_mastery[id])
            .filter(skill => skill.status === 'mastered')
            .sort((a, b) => b.score - a.score);
    }

    function nextLesson(curriculum, progress) {
        for (const module of modules(curriculum)) {
            if (moduleStatus(curriculum, progress, module.id) === 'locked') continue;
            for (const lesson of asArray(module.lessons)) {
                if (asObject(progress.lesson_progress[lesson.id]).status !== 'completed') {
                    return { module, lesson };
                }
            }
        }
        return null;
    }

    function spacedReview(curriculum, progress) {
        const index = indexCurriculum(curriculum);
        const candidates = strongestSkills(progress).sort((a, b) => Number(a.last_practiced_at || 0) - Number(b.last_practiced_at || 0));
        for (const skill of candidates) {
            const exercise = Object.values(index.exercises).find(item => item.skill === skill.skill_id && Number(item.difficulty || 1) <= 3);
            if (exercise) return { skill, exercise };
        }
        return null;
    }

    function dashboard(curriculum, progress) {
        const allModules = modules(curriculum);
        const allLessons = allModules.flatMap(module => asArray(module.lessons));
        const completedLessons = allLessons.filter(lesson => asObject(progress.lesson_progress[lesson.id]).status === 'completed').length;
        const skills = Object.values(progress.skill_mastery);
        const mastered = skills.filter(skill => skill.status === 'mastered');
        const recommendation = nextLesson(curriculum, progress);
        const currentModule = allModules.find(module => module.id === progress.current_module) || (recommendation && recommendation.module) || allModules[0] || {};
        const currentLesson = asArray(currentModule.lessons).find(lesson => lesson.id === progress.current_lesson)
            || (recommendation && recommendation.lesson) || asArray(currentModule.lessons)[0] || {};
        return {
            trainee_level: normalizeText(asObject(progress.onboarding).experience || 'new'),
            course_title: normalizeText(courseObject(curriculum).title || 'ISBD Training'),
            current_module: normalizeText(currentModule.title),
            current_lesson: normalizeText(currentLesson.title),
            course_progress: allLessons.length ? Math.round((completedLessons / allLessons.length) * 100) : 0,
            mastery_percentage: skills.length ? Math.round((mastered.length / skills.length) * 100) : 0,
            skills_mastered: mastered,
            skills_needing_review: weakSkills(curriculum, progress),
            strongest_skill: mastered[0] || null,
            recommended_next: recommendation,
            review_recommendations: asArray(progress.review_recommendations),
            recent_activity: asArray(progress.recent_activity).slice(0, 5),
            spaced_review: spacedReview(curriculum, progress),
            certification: asObject(progress.assessment_results.final)
        };
    }

    function supervisorSummary(curriculum, progress) {
        const view = dashboard(curriculum, progress);
        const attempts = Object.keys(progress.exercise_attempts).reduce((count, id) => count + asArray(progress.exercise_attempts[id]).length, 0);
        const failed = Object.keys(progress.exercise_attempts).reduce((count, id) => count
            + asArray(progress.exercise_attempts[id]).filter(attempt => !attempt.correct).length, 0);
        return {
            course_version: progress.course_version,
            guide_version: progress.guide_version,
            rules_version: progress.rules_version,
            completion_percent: view.course_progress,
            mastery_percentage: view.mastery_percentage,
            current_module: view.current_module,
            current_lesson: view.current_lesson,
            current_tier: view.trainee_level,
            trainee_level: view.trainee_level,
            skills_mastered: view.skills_mastered.map(skill => skill.title),
            weak_skills: view.skills_needing_review.map(skill => skill.title),
            exercise_attempts: attempts,
            failed_questions: failed,
            review_recommendations: view.review_recommendations.map(item => asObject(item).message).filter(Boolean),
            assessment_status: asObject(view.certification).status || 'not_started',
            assessment_score: Number(asObject(view.certification).score || 0),
            last_activity: Number(progress.last_activity || 0),
            requires_review: asArray(progress.requires_review)
        };
    }

    return {
        ENGINE_VERSION,
        clone,
        normalizeText,
        canonicalField,
        courseObject,
        modules,
        skillCatalog,
        curriculumVersions,
        indexCurriculum,
        createProgress,
        onboardingScreen,
        advanceOnboarding,
        setAdvancedMode,
        moduleStatus,
        selectLesson,
        completeLesson,
        evaluateExercise,
        recordExerciseAttempt,
        nextHint,
        revealAnswer,
        resetExerciseAssistance,
        calculateSkillMastery,
        refreshProgress,
        weakSkills,
        strongestSkills,
        nextLesson,
        spacedReview,
        dashboard,
        supervisorSummary
    };
});
