/* Professional, data-driven training workspace for the Koha staff client. */
(function(global) {
    'use strict';

    const engine = global.ISBDTrainingEngine;
    if (!engine) return;

    let active = null;

    function html(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function storageKey(settings) {
        const user = String(settings.currentUserId || 'anonymous').trim() || 'anonymous';
        const framework = String(settings.frameworkCode || 'default').trim() || 'default';
        return `isbdTrainingProgress:${user}:${framework}`;
    }

    function loadStoredProgress(curriculum, settings) {
        let stored = {};
        try {
            const raw = (global.localStorage && global.localStorage.getItem(storageKey(settings))) || '';
            if (raw) {
                stored = JSON.parse(raw);
            } else if (global.localStorage) {
                const user = String(settings.currentUserId || 'anonymous').trim() || 'anonymous';
                const framework = String(settings.frameworkCode || 'default').trim() || 'default';
                const legacyRaw = global.localStorage.getItem(`isbdGuideProgress:${user}:${framework}`) || '';
                if (legacyRaw) {
                    const legacy = JSON.parse(legacyRaw);
                    stored = {
                        engine_version: 'legacy-guide',
                        course_version: '2.0.0',
                        guide_version: '2.0.0',
                        rules_version: '1.0.0',
                        onboarding: { completed: true, screen: 4, experience: 'basic_marc' },
                        recent_activity: [{
                            at: Date.now(), type: 'version_review', module_id: '', lesson_id: '', exercise_id: '',
                            detail: `${Object.keys(legacy.completed || {}).length} legacy guide steps retained for audit; the rebuilt course requires competency review.`
                        }]
                    };
                }
            }
        } catch (error) {
            stored = {};
        }
        return engine.createProgress(curriculum, stored);
    }

    function pluginMethodUrl(settings, method) {
        const raw = String(settings.pluginPath || settings.pluginRunPath || '/cgi-bin/koha/plugins/run.pl');
        const url = new URL(raw, global.location && global.location.origin ? global.location.origin : 'http://localhost');
        if (!url.searchParams.get('class') && settings.pluginClass) url.searchParams.set('class', settings.pluginClass);
        url.searchParams.set('method', method);
        url.searchParams.set('op', 'cud-plugin_api');
        return `${url.pathname}?${url.searchParams.toString()}`;
    }

    function progressPayload(session) {
        const progress = session.progress;
        const summary = engine.supervisorSummary(session.curriculum, progress);
        const lessons = Object.keys(progress.lesson_progress || {});
        const completed = lessons.filter(id => (progress.lesson_progress[id] || {}).status === 'completed');
        const totalLessons = engine.modules(session.curriculum)
            .reduce((count, module) => count + (module.lessons || []).length, 0);
        summary.steps_total = totalLessons;
        summary.steps_completed = completed.length;
        summary.steps_skipped = 0;
        summary.completed_count = completed.length;
        summary.skipped_count = 0;
        summary.total = totalLessons;
        summary.current_step_key = progress.current_lesson || '';
        summary.current_step_title = summary.current_lesson || '';
        summary.modules_total = engine.modules(session.curriculum).length;
        summary.modules_completed = engine.modules(session.curriculum)
            .filter(module => ['completed', 'mastered'].includes((progress.module_progress[module.id] || {}).status)).length;
        summary.module_breakdown = {};
        engine.modules(session.curriculum).forEach(module => {
            const moduleLessons = (module.lessons || []).map(lesson => lesson.id);
            summary.module_breakdown[module.title] = {
                total: moduleLessons.length,
                completed: moduleLessons.filter(id => completed.includes(id)).length,
                skipped: 0
            };
        });
        return {
            signature: `${progress.course_version}|${progress.guide_version}|${progress.rules_version}`,
            completed,
            skipped: [],
            summary_counts: { completed_count: completed.length, skipped_count: 0, total: totalLessons },
            summary,
            training_progress: progress
        };
    }

    function saveLocal(session) {
        try {
            if (global.localStorage) {
                global.localStorage.setItem(storageKey(session.settings), JSON.stringify(session.progress));
            }
        } catch (error) {
            // Storage can be disabled; server persistence remains available.
        }
    }

    function sendProgress(session) {
        if (!session.settings.pluginPath || !global.ISBDApiClient || !global.ISBDApiClient.postJson) return Promise.resolve();
        return global.ISBDApiClient.postJson(
            pluginMethodUrl(session.settings, 'guide_progress_update'),
            progressPayload(session)
        ).catch(error => {
            session.syncMessage = `Saved on this device; server sync failed: ${error.message || 'unknown error'}`;
            updateSyncStatus(session);
        });
    }

    function persist(session, immediate) {
        saveLocal(session);
        global.clearTimeout(session.saveTimer);
        if (immediate) return sendProgress(session);
        session.saveTimer = global.setTimeout(() => sendProgress(session), 800);
        return Promise.resolve();
    }

    function updateSyncStatus(session) {
        const node = session.root && session.root.querySelector('[data-training-sync]');
        if (node) node.textContent = session.syncMessage || 'Progress saves automatically';
    }

    function statusLabel(status) {
        const labels = {
            not_started: 'Not started', in_progress: 'In progress', completed: 'Complete',
            mastered: 'Mastered', locked: 'Locked', review_required: 'Review required', missing: 'Unavailable'
        };
        return labels[status] || status;
    }

    function statusIcon(status) {
        if (status === 'mastered' || status === 'completed') return '✓';
        if (status === 'in_progress' || status === 'review_required') return '●';
        if (status === 'locked') return '🔒';
        return '○';
    }

    function courseTitle(session) {
        return engine.courseObject(session.curriculum).title || 'ISBD Training';
    }

    function renderShell(session) {
        const dashboard = engine.dashboard(session.curriculum, session.progress);
        session.root.innerHTML = `
            <div class="isbd-training-shell">
                <header class="isbd-training-header">
                    <div>
                        <div class="isbd-training-eyebrow">Professional cataloguing education</div>
                        <h2>${html(courseTitle(session))}</h2>
                    </div>
                    <div class="isbd-training-header-actions">
                        <span class="isbd-training-header-progress" aria-label="Course progress">${dashboard.course_progress}% course · ${dashboard.mastery_percentage}% mastery</span>
                        <button type="button" class="btn btn-sm btn-default" data-training-view="glossary">Glossary</button>
                        <button type="button" class="btn btn-sm btn-default" data-training-minimize>Minimize</button>
                        <button type="button" class="btn btn-sm isbd-btn-danger" data-training-close aria-label="Close training">Close</button>
                    </div>
                </header>
                <div class="isbd-training-body">
                    <nav class="isbd-training-path" aria-label="Course learning path"></nav>
                    <main class="isbd-training-main" tabindex="-1"></main>
                </div>
                <footer class="isbd-training-footer">
                    <span data-training-sync>Progress saves automatically</span>
                    <span>Learn → See → Try → Check → Understand → Practice → Master</span>
                </footer>
            </div>`;
        renderPath(session);
        bindShell(session);
        updateSyncStatus(session);
    }

    function bindShell(session) {
        session.root.querySelector('[data-training-close]').addEventListener('click', () => close(session));
        session.root.querySelector('[data-training-minimize]').addEventListener('click', event => {
            const minimized = session.root.classList.toggle('isbd-training-minimized');
            event.currentTarget.textContent = minimized ? 'Restore' : 'Minimize';
        });
        session.root.querySelector('[data-training-view="glossary"]').addEventListener('click', () => {
            session.view = 'glossary';
            renderMain(session);
        });
    }

    function renderPath(session) {
        const nav = session.root.querySelector('.isbd-training-path');
        nav.innerHTML = `
            <button type="button" class="isbd-training-home ${session.view === 'dashboard' ? 'active' : ''}" data-training-home>
                <span aria-hidden="true">⌂</span> Training home
            </button>
            <ol>${engine.modules(session.curriculum).map((module, index) => {
                const status = engine.moduleStatus(session.curriculum, session.progress, module.id);
                return `<li>
                    <button type="button" class="isbd-training-module ${status} ${session.progress.current_module === module.id ? 'current' : ''}"
                        data-module-id="${html(module.id)}" ${status === 'locked' ? 'aria-disabled="true"' : ''}>
                        <span class="isbd-training-module-number">${String(index + 1).padStart(2, '0')}</span>
                        <span><strong>${html(module.title)}</strong><small>${html(statusIcon(status))} ${html(statusLabel(status))}</small></span>
                    </button>
                </li>`;
            }).join('')}</ol>
            <label class="isbd-training-advanced">
                <input type="checkbox" data-training-advanced ${session.progress.advanced_mode ? 'checked' : ''}>
                Advanced review mode
                <small>Unlocks navigation only; it does not award mastery.</small>
            </label>`;
        nav.querySelector('[data-training-home]').addEventListener('click', () => {
            session.view = 'dashboard';
            render(session);
        });
        nav.querySelectorAll('[data-module-id]').forEach(button => {
            button.addEventListener('click', () => openModule(session, button.getAttribute('data-module-id')));
        });
        nav.querySelector('[data-training-advanced]').addEventListener('change', event => {
            engine.setAdvancedMode(session.progress, event.target.checked);
            persist(session);
            render(session);
        });
    }

    function render(session) {
        renderShell(session);
        renderMain(session);
    }

    function renderMain(session) {
        renderPath(session);
        if (!session.progress.onboarding.completed) return renderOnboarding(session);
        if (session.view === 'lesson') return renderLesson(session);
        if (session.view === 'glossary') return renderGlossary(session);
        return renderDashboard(session);
    }

    function renderOnboarding(session) {
        const main = session.root.querySelector('.isbd-training-main');
        const screen = engine.onboardingScreen(session.progress);
        const item = (session.curriculum.onboarding || [])[screen] || {};
        let content = '';
        if (screen === 0) {
            content = `<div class="isbd-training-welcome-mark" aria-hidden="true">ISBD</div><p>${html(item.body)}</p>`;
        } else if (screen === 1) {
            content = `<ul class="isbd-training-outcomes">${(item.items || []).map(value => `<li>✓ ${html(value)}</li>`).join('')}</ul>`;
        } else if (screen === 2) {
            content = `<fieldset class="isbd-training-experience"><legend class="sr-only">Experience level</legend>${(item.options || []).map((option, index) => `
                <label><input type="radio" name="training-experience" value="${html(option.value)}" ${index === 0 ? 'checked' : ''}> ${html(option.label)}</label>`).join('')}</fieldset>`;
        } else {
            content = `<p>${html(item.body)}</p><div class="isbd-training-model" aria-label="Learning model"><span>Learn</span><span>See</span><span>Try</span><span>Check</span><span>Master</span></div>`;
        }
        main.innerHTML = `<section class="isbd-training-onboarding" aria-labelledby="training-onboarding-title">
            <div class="isbd-training-step-dots" aria-label="Onboarding step ${screen + 1} of 4">${[0, 1, 2, 3].map(i => `<span class="${i === screen ? 'active' : ''}"></span>`).join('')}</div>
            <h1 id="training-onboarding-title">${html(item.title)}</h1>
            ${content}
            <div class="isbd-training-actions">
                ${screen > 0 ? '<button type="button" class="btn btn-default" data-onboarding-back>Back</button>' : ''}
                <button type="button" class="btn btn-primary" data-onboarding-next>${screen === 0 ? 'Start training' : (screen === 3 ? 'Begin first lesson' : 'Continue')}</button>
            </div>
        </section>`;
        const back = main.querySelector('[data-onboarding-back]');
        if (back) back.addEventListener('click', () => {
            session.progress.onboarding.screen = Math.max(0, screen - 1);
            persist(session);
            renderMain(session);
        });
        main.querySelector('[data-onboarding-next]').addEventListener('click', () => {
            const selected = main.querySelector('input[name="training-experience"]:checked');
            engine.advanceOnboarding(session.curriculum, session.progress, {
                experience: selected ? selected.value : undefined,
                complete: screen === 3
            });
            persist(session);
            if (session.progress.onboarding.completed) session.view = 'dashboard';
            render(session);
        });
        main.focus();
    }

    function activityLabel(item) {
        const labels = {
            lesson_opened: 'Opened lesson', lesson_completed: 'Completed lesson',
            exercise_correct: 'Completed practice', exercise_failed: 'Practice needs review',
            hint_used: 'Used a progressive hint', version_review: 'Training changed'
        };
        return labels[item.type] || 'Training activity';
    }

    function renderDashboard(session) {
        const main = session.root.querySelector('.isbd-training-main');
        const view = engine.dashboard(session.curriculum, session.progress);
        const next = view.recommended_next;
        const strongest = view.strongest_skill ? view.strongest_skill.title : 'Not enough evidence yet';
        const weak = view.skills_needing_review.length ? view.skills_needing_review.map(skill => skill.title).join(', ') : 'No recurring weakness detected';
        const recommendations = view.review_recommendations;
        const startingModule = engine.modules(session.curriculum)
            .find(module => module.id === session.progress.onboarding.recommended_module);
        main.innerHTML = `
            <section class="isbd-training-dashboard" aria-labelledby="training-dashboard-title">
                <div class="isbd-training-dashboard-hero">
                    <div>
                        <div class="isbd-training-eyebrow">Welcome back</div>
                        <h1 id="training-dashboard-title">Continue building cataloguing judgment</h1>
                        <p>You're currently learning <strong>${html(view.current_lesson || view.current_module)}</strong>.</p>
                    </div>
                    ${next ? '<button type="button" class="btn btn-lg btn-primary" data-continue-training>Continue training →</button>' : ''}
                </div>
                <div class="isbd-training-metrics">
                    <article><strong>${view.course_progress}%</strong><span>Course progress</span><div class="isbd-progress-bar"><span style="width:${view.course_progress}%"></span></div></article>
                    <article><strong>${view.mastery_percentage}%</strong><span>Demonstrated mastery</span><div class="isbd-progress-bar"><span style="width:${view.mastery_percentage}%"></span></div></article>
                    <article><strong>${view.skills_mastered.length}</strong><span>Skills mastered</span></article>
                </div>
                <div class="isbd-training-dashboard-grid">
                    <article class="isbd-training-card"><h2>Competency profile</h2><p><strong>Strongest skill</strong><br>${html(strongest)}</p><p><strong>Needs practice</strong><br>${html(weak)}</p></article>
                    <article class="isbd-training-card"><h2>Recommended next</h2>${next ? `<p><strong>${html(next.module.title)}</strong><br>${html(next.lesson.title)}</p><button type="button" class="btn btn-primary" data-continue-training>Open lesson</button>` : '<p>All available lessons are complete. Review recommendations or take the final assessment.</p>'}${startingModule ? `<p><small>Experience-based entry point: ${html(startingModule.title)}. Prerequisites still apply unless advanced review mode is explicit.</small></p>` : ''}</article>
                    <article class="isbd-training-card"><h2>Recent activity</h2>${view.recent_activity.length ? `<ul>${view.recent_activity.map(item => `<li>${html(activityLabel(item))}${item.detail ? ` — ${html(item.detail)}` : ''}</li>`).join('')}</ul>` : '<p>Your completed practice and reviews will appear here.</p>'}</article>
                    <article class="isbd-training-card"><h2>Recommended review</h2>${recommendations.length ? `<ul>${recommendations.map(item => `<li>${html(item.message)}</li>`).join('')}</ul>` : '<p>No targeted remediation is due yet. Previously mastered skills will return as short spaced reviews.</p>'}</article>
                    ${view.spaced_review ? `<article class="isbd-training-card"><h2>Quick spaced review</h2><p><strong>${html(view.spaced_review.skill.title)}</strong><br>${html(view.spaced_review.exercise.prompt)}</p><button type="button" class="btn btn-default" data-spaced-review="${html(view.spaced_review.exercise.id)}">Review now</button></article>` : ''}
                </div>
            </section>`;
        main.querySelectorAll('[data-continue-training]').forEach(button => button.addEventListener('click', () => {
            if (next) openLesson(session, next.module.id, next.lesson.id);
        }));
        const reviewButton = main.querySelector('[data-spaced-review]');
        if (reviewButton) reviewButton.addEventListener('click', () => {
            const exerciseId = reviewButton.getAttribute('data-spaced-review');
            const index = engine.indexCurriculum(session.curriculum);
            const location = index.exerciseLocations[exerciseId] || {};
            const lesson = index.lessons[location.lesson_id] || {};
            const exercises = (lesson.exercises || []).concat(lesson.questions || []);
            openLesson(session, location.module_id, location.lesson_id);
            session.exerciseIndex = Math.max(0, exercises.findIndex(exercise => exercise.id === exerciseId));
            render(session);
        });
        main.focus();
    }

    function openModule(session, moduleId) {
        const status = engine.moduleStatus(session.curriculum, session.progress, moduleId);
        if (status === 'locked') {
            session.syncMessage = 'Complete and master the prerequisite module before continuing.';
            updateSyncStatus(session);
            return;
        }
        const module = engine.modules(session.curriculum).find(item => item.id === moduleId);
        if (!module) return;
        const lesson = (module.lessons || []).find(item => (session.progress.lesson_progress[item.id] || {}).status !== 'completed')
            || (module.lessons || [])[0];
        if (lesson) openLesson(session, moduleId, lesson.id);
    }

    function openLesson(session, moduleId, lessonId) {
        const result = engine.selectLesson(session.curriculum, session.progress, moduleId, lessonId);
        if (!result.ok) {
            session.syncMessage = result.reason === 'prerequisite_locked'
                ? 'This lesson is locked until its prerequisite is mastered.' : 'Unable to open that lesson.';
            updateSyncStatus(session);
            return;
        }
        session.view = 'lesson';
        session.exerciseIndex = 0;
        session.feedback = {};
        session.hint = '';
        persist(session);
        render(session);
    }

    function currentContext(session) {
        const index = engine.indexCurriculum(session.curriculum);
        return {
            module: index.modules[session.progress.current_module] || {},
            lesson: index.lessons[session.progress.current_lesson] || {}
        };
    }

    function sectionLabel(key) {
        const labels = { introduction: 'Introduction', why_it_matters: 'Why it matters', learn: 'Learn', see_it: 'See it', reflection: 'Reflection' };
        return labels[key] || key.replace(/_/g, ' ');
    }

    function renderLesson(session) {
        const main = session.root.querySelector('.isbd-training-main');
        const context = currentContext(session);
        const lesson = context.lesson;
        const exercises = (lesson.exercises || []).concat(lesson.questions || []);
        session.exerciseIndex = Math.min(session.exerciseIndex || 0, Math.max(exercises.length - 1, 0));
        const exercise = exercises[session.exerciseIndex];
        const moduleNumber = engine.modules(session.curriculum).findIndex(item => item.id === context.module.id) + 1;
        const lessonNumber = (context.module.lessons || []).findIndex(item => item.id === lesson.id) + 1;
        main.innerHTML = `
            <section class="isbd-training-lesson" aria-labelledby="training-lesson-title">
                <nav class="isbd-training-breadcrumb" aria-label="Current training location">
                    <button type="button" data-training-dashboard>ISBD Training</button><span>›</span>
                    <span>${html(context.module.title)}</span><span>›</span><span>${html(lesson.title)}</span>
                </nav>
                <div class="isbd-training-lesson-heading">
                    <div><div class="isbd-training-eyebrow">Module ${moduleNumber} · Lesson ${lessonNumber} of ${(context.module.lessons || []).length}</div><h1 id="training-lesson-title">${html(lesson.title)}</h1></div>
                    <span class="isbd-training-level">${html(context.module.level || 'course')}</span>
                </div>
                <div class="isbd-training-concept-sections">${Object.keys(lesson.sections || {}).map(key => `
                    <article class="isbd-training-concept ${key}"><h2>${html(sectionLabel(key))}</h2><p>${html(lesson.sections[key])}</p></article>`).join('')}</div>
                ${exercise ? renderExerciseMarkup(session, exercise, session.exerciseIndex, exercises.length) : '<p>No exercise is required for this lesson.</p>'}
                <div class="isbd-training-lesson-footer">
                    <button type="button" class="btn btn-default" data-training-dashboard>Back to dashboard</button>
                    <button type="button" class="btn btn-primary" data-complete-lesson>Complete lesson</button>
                </div>
            </section>`;
        bindLesson(session, exercises, exercise);
        main.focus();
    }

    function renderExerciseMarkup(session, exercise, index, total) {
        const attemptList = session.progress.exercise_attempts[exercise.id] || [];
        const last = attemptList[attemptList.length - 1];
        const feedback = session.feedback[exercise.id];
        return `<section class="isbd-training-practice" aria-labelledby="training-practice-title">
            <div class="isbd-training-practice-heading">
                <div><div class="isbd-training-eyebrow">Practice ${index + 1} of ${total} · Difficulty ${html(exercise.difficulty || 1)}</div><h2 id="training-practice-title">${html(exercise.prompt)}</h2></div>
                <span class="isbd-training-skill">${html((engine.indexCurriculum(session.curriculum).skills[exercise.skill] || {}).title || exercise.skill)}</span>
            </div>
            ${exercise.initial_record || exercise.type === 'field_builder' || exercise.type === 'record_construction'
                ? renderFieldLab(exercise, session.answers[exercise.id]) : renderAnswerControl(exercise, session.answers[exercise.id])}
            <div class="isbd-training-practice-actions">
                <button type="button" class="btn btn-primary" data-check-answer>Check answer</button>
                <button type="button" class="btn btn-default" data-hint>Give me a hint</button>
                <button type="button" class="btn btn-default" data-explain>Explain the rule</button>
                <button type="button" class="btn btn-default" data-show-answer>Show answer</button>
                <button type="button" class="btn btn-link" data-reset-exercise>Reset</button>
            </div>
            <div class="isbd-training-feedback" aria-live="polite">
                ${session.hint && session.hint.exerciseId === exercise.id ? `<div class="hint"><strong>Hint ${session.hint.index}</strong><p>${html(session.hint.text)}</p></div>` : ''}
                ${feedback ? `<div class="${feedback.correct ? 'correct' : 'incorrect'}"><strong>${feedback.correct ? 'Correct' : 'Try again'}</strong><p>${html(feedback.message)}</p>${feedback.showExplanation ? `<p>${html(feedback.explanation)}</p>` : ''}</div>` : ''}
                ${last && last.answer_revealed ? '<p class="isbd-training-notice">This revealed attempt is recorded for review and cannot award mastery.</p>' : ''}
            </div>
            <div class="isbd-training-exercise-nav">
                <button type="button" class="btn btn-default" data-exercise-prev ${index === 0 ? 'disabled' : ''}>Previous practice</button>
                <span>${index + 1} / ${total}</span>
                <button type="button" class="btn btn-default" data-exercise-next ${index >= total - 1 ? 'disabled' : ''}>Next practice</button>
            </div>
            ${session.settings.aiEnable ? renderTutorMarkup(exercise) : ''}
        </section>`;
    }

    function defaultField(exercise) {
        return engine.clone(exercise.initial_record || { tag: '245', ind1: ' ', ind2: ' ', subfields: [{ code: 'a', value: '' }] });
    }

    function renderFieldLab(exercise, current) {
        const field = current && typeof current === 'object' ? current : defaultField(exercise);
        return `<fieldset class="isbd-training-lab"><legend>Interactive MARC training lab</legend>
            <div class="isbd-training-field-meta">
                <label>Tag <input class="form-control input-sm" maxlength="3" value="${html(field.tag || '')}" data-field-tag></label>
                <label>Indicator 1 <input class="form-control input-sm" maxlength="1" value="${html(field.ind1 || ' ')}" data-field-ind1></label>
                <label>Indicator 2 <input class="form-control input-sm" maxlength="1" value="${html(field.ind2 || ' ')}" data-field-ind2></label>
            </div>
            <div data-subfield-list>${(field.subfields || []).map((subfield, index) => `
                <div class="isbd-training-subfield" data-subfield-row>
                    <label><span>Code</span><input class="form-control input-sm" maxlength="1" value="${html(subfield.code || '')}" data-subfield-code></label>
                    <label class="value"><span>Value</span><input class="form-control input-sm" value="${html(subfield.value || '')}" data-subfield-value></label>
                    <div class="isbd-training-row-actions">
                        <button type="button" class="btn btn-xs btn-default" data-move-up aria-label="Move subfield up" ${index === 0 ? 'disabled' : ''}>↑</button>
                        <button type="button" class="btn btn-xs btn-default" data-move-down aria-label="Move subfield down" ${index === (field.subfields || []).length - 1 ? 'disabled' : ''}>↓</button>
                        <button type="button" class="btn btn-xs btn-default" data-remove-subfield aria-label="Remove subfield">Remove</button>
                    </div>
                </div>`).join('')}</div>
            <button type="button" class="btn btn-sm btn-default" data-add-subfield>Add subfield</button>
        </fieldset>`;
    }

    function renderAnswerControl(exercise, current) {
        const options = exercise.options || [];
        if (exercise.type === 'error_detection' || exercise.type === 'multi_select') {
            const selected = Array.isArray(current) ? current : [];
            return `<fieldset class="isbd-training-choices"><legend>Select every applicable answer</legend>${options.map(option => `<label><input type="checkbox" name="exercise-answer" value="${html(option)}" ${selected.includes(option) ? 'checked' : ''}> ${html(option)}</label>`).join('')}</fieldset>`;
        }
        if (options.length) {
            return `<fieldset class="isbd-training-choices"><legend>Select one answer</legend>${options.map(option => `<label><input type="radio" name="exercise-answer" value="${html(option)}" ${current === option ? 'checked' : ''}> ${html(option)}</label>`).join('')}</fieldset>`;
        }
        return `<label class="isbd-training-text-answer">Your answer<textarea class="form-control" rows="3" data-text-answer>${html(current || '')}</textarea></label>`;
    }

    function readAnswer(main, exercise) {
        if (exercise.initial_record || exercise.type === 'field_builder' || exercise.type === 'record_construction') {
            return {
                tag: (main.querySelector('[data-field-tag]') || {}).value || '',
                ind1: (main.querySelector('[data-field-ind1]') || {}).value || ' ',
                ind2: (main.querySelector('[data-field-ind2]') || {}).value || ' ',
                subfields: Array.from(main.querySelectorAll('[data-subfield-row]')).map(row => ({
                    code: row.querySelector('[data-subfield-code]').value || '',
                    value: row.querySelector('[data-subfield-value]').value || ''
                }))
            };
        }
        if (exercise.type === 'error_detection' || exercise.type === 'multi_select') {
            return Array.from(main.querySelectorAll('input[name="exercise-answer"]:checked')).map(input => input.value);
        }
        const selected = main.querySelector('input[name="exercise-answer"]:checked');
        if (selected) return selected.value;
        const text = main.querySelector('[data-text-answer]');
        return text ? text.value : '';
    }

    function bindFieldLab(session, exercise) {
        const main = session.root.querySelector('.isbd-training-main');
        const capture = () => { session.answers[exercise.id] = readAnswer(main, exercise); };
        main.querySelectorAll('input').forEach(input => input.addEventListener('input', capture));
        const add = main.querySelector('[data-add-subfield]');
        if (add) add.addEventListener('click', () => {
            capture();
            session.answers[exercise.id].subfields.push({ code: '', value: '' });
            renderLesson(session);
        });
        main.querySelectorAll('[data-subfield-row]').forEach((row, index) => {
            const remove = row.querySelector('[data-remove-subfield]');
            const up = row.querySelector('[data-move-up]');
            const down = row.querySelector('[data-move-down]');
            remove.addEventListener('click', () => {
                capture();
                session.answers[exercise.id].subfields.splice(index, 1);
                renderLesson(session);
            });
            up.addEventListener('click', () => {
                capture();
                const list = session.answers[exercise.id].subfields;
                [list[index - 1], list[index]] = [list[index], list[index - 1]];
                renderLesson(session);
            });
            down.addEventListener('click', () => {
                capture();
                const list = session.answers[exercise.id].subfields;
                [list[index + 1], list[index]] = [list[index], list[index + 1]];
                renderLesson(session);
            });
        });
    }

    function bindLesson(session, exercises, exercise) {
        const main = session.root.querySelector('.isbd-training-main');
        main.querySelectorAll('[data-training-dashboard]').forEach(button => button.addEventListener('click', () => {
            session.view = 'dashboard';
            render(session);
        }));
        main.querySelector('[data-complete-lesson]').addEventListener('click', () => {
            const result = engine.completeLesson(session.curriculum, session.progress, session.progress.current_lesson);
            if (!result.ok) {
                session.syncMessage = `Complete the required practice first (${result.missing.length} remaining).`;
                updateSyncStatus(session);
                return;
            }
            persist(session);
            session.view = 'dashboard';
            render(session);
        });
        if (!exercise) return;
        if (exercise.initial_record || exercise.type === 'field_builder' || exercise.type === 'record_construction') bindFieldLab(session, exercise);
        main.querySelector('[data-check-answer]').addEventListener('click', () => {
            const answer = readAnswer(main, exercise);
            session.answers[exercise.id] = answer;
            const recorded = engine.recordExerciseAttempt(session.curriculum, session.progress, exercise.id, answer);
            if (!recorded.ok) return;
            session.feedback[exercise.id] = {
                correct: recorded.result.correct,
                message: recorded.result.feedback,
                explanation: recorded.result.explanation,
                showExplanation: recorded.result.correct
            };
            persist(session);
            render(session);
        });
        main.querySelector('[data-hint]').addEventListener('click', () => {
            const hint = engine.nextHint(session.progress, exercise);
            session.hint = { exerciseId: exercise.id, index: hint.index, text: hint.hint };
            persist(session);
            renderLesson(session);
        });
        main.querySelector('[data-explain]').addEventListener('click', () => {
            session.feedback[exercise.id] = {
                correct: false,
                message: exercise.referenced_rule ? `Relevant rule: ${exercise.referenced_rule}` : `Relevant concept: ${exercise.referenced_concept || 'cataloguing judgment'}`,
                explanation: exercise.explanation || '',
                showExplanation: true
            };
            renderLesson(session);
        });
        main.querySelector('[data-show-answer]').addEventListener('click', () => {
            const revealed = engine.revealAnswer(session.progress, exercise);
            session.answers[exercise.id] = engine.clone(revealed.answer);
            session.feedback[exercise.id] = {
                correct: false, message: `Model answer: ${formatAnswer(revealed.answer)}`,
                explanation: revealed.explanation, showExplanation: true
            };
            persist(session);
            renderLesson(session);
        });
        main.querySelector('[data-reset-exercise]').addEventListener('click', () => {
            engine.resetExerciseAssistance(session.progress, exercise.id);
            session.answers[exercise.id] = exercise.initial_record ? defaultField(exercise) : (exercise.type === 'error_detection' ? [] : '');
            delete session.feedback[exercise.id];
            session.hint = '';
            persist(session);
            renderLesson(session);
        });
        main.querySelector('[data-exercise-prev]').addEventListener('click', () => {
            session.exerciseIndex = Math.max(0, session.exerciseIndex - 1);
            session.hint = '';
            renderLesson(session);
        });
        main.querySelector('[data-exercise-next]').addEventListener('click', () => {
            session.exerciseIndex = Math.min(exercises.length - 1, session.exerciseIndex + 1);
            session.hint = '';
            renderLesson(session);
        });
        bindTutor(session, exercise);
    }

    function formatAnswer(answer) {
        if (Array.isArray(answer)) return answer.join('; ');
        if (answer && typeof answer === 'object') {
            return `${answer.tag || ''} ${answer.ind1 || ' '}${answer.ind2 || ' '} ${(answer.subfields || []).map(subfield => `$${subfield.code} ${subfield.value}`).join(' ')}`;
        }
        return String(answer || '');
    }

    function renderTutorMarkup() {
        return `<details class="isbd-training-tutor">
            <summary>Optional AI tutor</summary>
            <p>AI is advisory. Deterministic rules and authoritative cataloguing guidance remain primary.</p>
            <label>Ask about this exercise <input class="form-control input-sm" data-tutor-question placeholder="Why is this wrong?"></label>
            <div class="isbd-training-tutor-actions">
                <button type="button" class="btn btn-sm btn-default" data-tutor-mode="hint">Hint without the answer</button>
                <button type="button" class="btn btn-sm btn-default" data-tutor-mode="beginner">Explain for a beginner</button>
                <button type="button" class="btn btn-sm btn-default" data-tutor-mode="rule">Show the relevant rule</button>
            </div>
            <div data-tutor-output aria-live="polite"></div>
        </details>`;
    }

    function tutorTagContext(exercise, answer) {
        const field = answer && typeof answer === 'object' && !Array.isArray(answer)
            ? engine.canonicalField(answer)
            : engine.canonicalField(exercise.initial_record || { tag: '245', ind1: ' ', ind2: ' ', subfields: [{ code: 'a', value: String(answer || exercise.prompt || '') }] });
        return { ...field, occurrence: 0, active_subfield: (field.subfields[0] || {}).code || 'a' };
    }

    function bindTutor(session, exercise) {
        const main = session.root.querySelector('.isbd-training-main');
        main.querySelectorAll('[data-tutor-mode]').forEach(button => button.addEventListener('click', async () => {
            const output = main.querySelector('[data-tutor-output]');
            const question = (main.querySelector('[data-tutor-question]') || {}).value || '';
            const mode = button.getAttribute('data-tutor-mode');
            output.textContent = 'Tutor is reviewing the curriculum context…';
            button.disabled = true;
            try {
                const answer = readAnswer(main, exercise);
                const result = await global.ISBDApiClient.aiSuggest(session.settings.pluginPath, {
                    request_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    task: 'training_tutor',
                    context_mode: 'tag_only',
                    tag_context: tutorTagContext(exercise, answer),
                    tutor_request: {
                        mode,
                        question: String(question || '').slice(0, 500),
                        curriculum_context: `${exercise.prompt} | ${exercise.referenced_concept || ''} | ${exercise.referenced_rule || ''}`.slice(0, 1200),
                        do_not_reveal_answer: mode === 'hint'
                    }
                });
                output.textContent = result.explanation || result.assistant_message || 'The tutor did not return an explanation.';
            } catch (error) {
                output.textContent = `Tutor unavailable: ${error.message || 'request failed'}`;
            } finally {
                button.disabled = false;
            }
        }));
    }

    function renderGlossary(session) {
        const main = session.root.querySelector('.isbd-training-main');
        main.innerHTML = `<section class="isbd-training-glossary" aria-labelledby="training-glossary-title">
            <nav class="isbd-training-breadcrumb"><button type="button" data-training-dashboard>ISBD Training</button><span>›</span><span>Glossary</span></nav>
            <h1 id="training-glossary-title">Contextual glossary</h1>
            <p>Concise definitions for terms used throughout the course.</p>
            <label class="isbd-training-glossary-search">Search terms<input class="form-control" type="search" data-glossary-search></label>
            <dl>${(session.curriculum.glossary || []).map(entry => `<div data-glossary-entry><dt>${html(entry.term)}</dt><dd>${html(entry.definition)}</dd></div>`).join('')}</dl>
        </section>`;
        main.querySelector('[data-training-dashboard]').addEventListener('click', () => {
            session.view = 'dashboard';
            render(session);
        });
        main.querySelector('[data-glossary-search]').addEventListener('input', event => {
            const query = event.target.value.toLocaleLowerCase().trim();
            main.querySelectorAll('[data-glossary-entry]').forEach(entry => {
                entry.hidden = query && !entry.textContent.toLocaleLowerCase().includes(query);
            });
        });
        main.focus();
    }

    function injectStyles() {
        if (document.getElementById('isbd-training-workspace-styles')) return;
        const style = document.createElement('style');
        style.id = 'isbd-training-workspace-styles';
        style.textContent = `
            .isbd-training-workspace{position:fixed;inset:4vh 3vw;z-index:10020;background:#f7f8f5;border:1px solid #bcc8bc;border-radius:10px;box-shadow:0 24px 70px rgba(15,23,42,.3);overflow:hidden;color:#243128}
            .isbd-training-shell{height:100%;display:flex;flex-direction:column}.isbd-training-header{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px 20px;background:#245d3b;color:#fff}.isbd-training-header h2{font-size:20px;margin:1px 0 0}.isbd-training-eyebrow{text-transform:uppercase;letter-spacing:.08em;font-size:10px;font-weight:700;opacity:.78}.isbd-training-header-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.isbd-training-header-progress{font-weight:700;margin-right:8px}.isbd-training-body{display:grid;grid-template-columns:250px minmax(0,1fr);flex:1;min-height:0}.isbd-training-path{background:#edf1eb;border-right:1px solid #d3ddd1;padding:14px 10px;overflow:auto}.isbd-training-path ol{list-style:none;margin:10px 0;padding:0}.isbd-training-home,.isbd-training-module{width:100%;border:0;background:transparent;text-align:left;border-radius:7px;padding:9px;color:#27372d}.isbd-training-home:hover,.isbd-training-home:focus,.isbd-training-module:hover,.isbd-training-module:focus,.isbd-training-module.current{background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.08)}.isbd-training-module{display:flex;gap:9px;align-items:flex-start}.isbd-training-module.locked{opacity:.62}.isbd-training-module small{display:block;color:#607065;margin-top:2px}.isbd-training-module-number{font:700 11px/1.7 monospace;color:#557160}.isbd-training-advanced{display:block;border-top:1px solid #ccd7ca;padding:12px 7px 0;font-weight:600}.isbd-training-advanced small{display:block;color:#68766c;font-weight:400;margin-left:20px}.isbd-training-main{overflow:auto;padding:24px 30px;outline:none}.isbd-training-footer{display:flex;justify-content:space-between;gap:16px;padding:7px 18px;background:#fff;border-top:1px solid #d9e0d7;color:#657268;font-size:11px}.isbd-training-minimized{height:54px;inset:auto 20px 20px auto;width:min(720px,calc(100vw - 40px))}.isbd-training-minimized .isbd-training-body,.isbd-training-minimized .isbd-training-footer{display:none}.isbd-training-onboarding{max-width:760px;margin:5vh auto;background:#fff;border:1px solid #dce4da;border-radius:12px;padding:38px;text-align:center}.isbd-training-onboarding h1{font-size:30px}.isbd-training-welcome-mark{display:inline-grid;place-items:center;width:86px;height:86px;border-radius:50%;background:#e4efe6;color:#245d3b;font-weight:800}.isbd-training-step-dots span{display:inline-block;width:9px;height:9px;border-radius:50%;background:#c8d2c7;margin:0 4px}.isbd-training-step-dots span.active{background:#2f754b}.isbd-training-outcomes{columns:2;text-align:left;list-style:none;padding:0}.isbd-training-outcomes li{padding:7px}.isbd-training-experience{display:grid;grid-template-columns:1fr 1fr;gap:10px;border:0}.isbd-training-experience label,.isbd-training-choices label{display:block;border:1px solid #ccd7ca;background:#fafbf9;border-radius:7px;padding:11px;text-align:left;font-weight:500}.isbd-training-model{display:flex;justify-content:center;flex-wrap:wrap;gap:8px}.isbd-training-model span{background:#e7efe7;border-radius:999px;padding:8px 13px;font-weight:700}.isbd-training-actions{display:flex;justify-content:center;gap:8px;margin-top:24px}.isbd-training-dashboard-hero{display:flex;justify-content:space-between;gap:24px;align-items:center;background:#fff;border:1px solid #dce4da;border-radius:10px;padding:22px}.isbd-training-dashboard-hero h1{margin:3px 0 8px}.isbd-training-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:14px 0}.isbd-training-metrics article,.isbd-training-card{background:#fff;border:1px solid #dce4da;border-radius:9px;padding:16px}.isbd-training-metrics strong{display:block;font-size:28px;color:#245d3b}.isbd-training-metrics span{color:#617067}.isbd-training-dashboard-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.isbd-training-card h2{font-size:16px;margin-top:0}.isbd-training-card ul{padding-left:18px}.isbd-training-breadcrumb{display:flex;gap:7px;align-items:center;color:#607065;margin-bottom:12px}.isbd-training-breadcrumb button{border:0;background:transparent;color:#276947;padding:0;text-decoration:underline}.isbd-training-lesson-heading,.isbd-training-practice-heading{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.isbd-training-lesson-heading h1{margin:2px 0 15px}.isbd-training-level,.isbd-training-skill{background:#e5eee5;color:#275f3f;padding:6px 10px;border-radius:999px;font-size:11px;font-weight:700}.isbd-training-concept-sections{display:grid;grid-template-columns:1fr 1fr;gap:10px}.isbd-training-concept{background:#fff;border:1px solid #dce4da;border-radius:8px;padding:13px}.isbd-training-concept h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#37644a;margin:0 0 5px}.isbd-training-concept.see_it{font-family:monospace;background:#f1f5f0}.isbd-training-practice{background:#fff;border:1px solid #cbd9ca;border-left:5px solid #347c50;border-radius:9px;margin-top:16px;padding:18px}.isbd-training-practice-heading h2{font-size:18px;margin:3px 0 14px}.isbd-training-choices{border:0;padding:0;display:grid;gap:7px}.isbd-training-lab{border:1px solid #d4ded2;background:#f8faf7;border-radius:8px;padding:13px}.isbd-training-lab legend{font-size:13px;font-weight:700;border:0;width:auto;padding:0 5px}.isbd-training-field-meta{display:flex;gap:10px}.isbd-training-field-meta label:first-child{width:110px}.isbd-training-field-meta label{width:90px}.isbd-training-subfield{display:flex;align-items:flex-end;gap:8px;margin:8px 0}.isbd-training-subfield label{margin:0}.isbd-training-subfield label.value{flex:1}.isbd-training-subfield label span{display:block;font-size:11px}.isbd-training-row-actions{display:flex;gap:4px}.isbd-training-practice-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:14px}.isbd-training-feedback>div,.isbd-training-notice{padding:10px;border-radius:7px;margin-top:10px}.isbd-training-feedback .correct{background:#e8f4ea;border-left:4px solid #347c50}.isbd-training-feedback .incorrect{background:#fff1e5;border-left:4px solid #b66b27}.isbd-training-feedback .hint{background:#edf3fa;border-left:4px solid #47799e}.isbd-training-notice{background:#fff8db}.isbd-training-exercise-nav,.isbd-training-lesson-footer{display:flex;justify-content:space-between;align-items:center;margin-top:15px}.isbd-training-tutor{margin-top:14px;border-top:1px solid #dae2d8;padding-top:10px}.isbd-training-tutor summary{cursor:pointer;font-weight:700}.isbd-training-tutor-actions{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.isbd-training-glossary{max-width:880px}.isbd-training-glossary-search{max-width:420px}.isbd-training-glossary dl{display:grid;grid-template-columns:1fr 1fr;gap:10px}.isbd-training-glossary dl div{background:#fff;border:1px solid #dce4da;border-radius:8px;padding:12px}.isbd-training-glossary dt{color:#275f3f}.isbd-training-glossary dd{margin:4px 0 0}.isbd-training-workspace button:focus,.isbd-training-workspace input:focus,.isbd-training-workspace textarea:focus,.isbd-training-workspace summary:focus{outline:3px solid #f0c419!important;outline-offset:2px}.isbd-training-workspace .isbd-progress-bar{height:7px;background:#e1e7df;border-radius:999px;overflow:hidden;margin-top:7px}.isbd-training-workspace .isbd-progress-bar span{display:block;height:100%;background:#347c50}
            @media(max-width:900px){.isbd-training-workspace{inset:8px}.isbd-training-body{grid-template-columns:1fr}.isbd-training-path{border-right:0;border-bottom:1px solid #d3ddd1;max-height:175px}.isbd-training-path ol{display:flex;overflow:auto}.isbd-training-path li{min-width:210px}.isbd-training-advanced{display:none}.isbd-training-main{padding:16px}.isbd-training-concept-sections,.isbd-training-dashboard-grid,.isbd-training-glossary dl{grid-template-columns:1fr}.isbd-training-header-progress{display:none}}
            @media(max-width:600px){.isbd-training-header{align-items:flex-start}.isbd-training-header h2{font-size:15px}.isbd-training-header-actions{justify-content:flex-end}.isbd-training-metrics{grid-template-columns:1fr}.isbd-training-dashboard-hero,.isbd-training-lesson-heading,.isbd-training-practice-heading{display:block}.isbd-training-experience{grid-template-columns:1fr}.isbd-training-subfield{align-items:stretch;flex-wrap:wrap}.isbd-training-row-actions{width:100%}.isbd-training-footer span:last-child{display:none}}
            @media(prefers-reduced-motion:reduce){.isbd-training-workspace *{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
        `;
        document.head.appendChild(style);
    }

    function close(session) {
        global.clearTimeout(session.saveTimer);
        persist(session, true);
        document.removeEventListener('keydown', session.keyHandler);
        if (session.backdrop && session.backdrop.parentNode) session.backdrop.parentNode.removeChild(session.backdrop);
        if (session.root && session.root.parentNode) session.root.parentNode.removeChild(session.root);
        if (session.state) {
            session.state.guideActive = false;
            session.state.guideRefresh = null;
            session.state.guideCurrentStep = null;
        }
        if (typeof session.onClose === 'function') session.onClose();
        active = null;
    }

    function open(settings, state, options) {
        if (active) {
            active.root.classList.remove('isbd-training-minimized');
            active.root.querySelector('.isbd-training-main').focus();
            return active;
        }
        const curriculum = global.ISBDTrainingCurriculum;
        if (!curriculum || !Array.isArray(curriculum.modules)) throw new Error('Training curriculum is unavailable.');
        injectStyles();
        const backdrop = document.createElement('div');
        backdrop.className = 'isbd-guide-backdrop';
        const root = document.createElement('div');
        root.className = 'isbd-training-workspace';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-label', 'ISBD cataloguing training workspace');
        document.body.appendChild(backdrop);
        document.body.appendChild(root);
        const session = {
            curriculum, settings: settings || {}, state: state || {}, root, backdrop,
            progress: loadStoredProgress(curriculum, settings || {}), view: 'dashboard', exerciseIndex: 0,
            answers: {}, feedback: {}, hint: '', syncMessage: '', saveTimer: null,
            onClose: options && options.onClose
        };
        session.keyHandler = event => {
            if (event.key === 'Escape' && !root.classList.contains('isbd-training-minimized')) close(session);
        };
        document.addEventListener('keydown', session.keyHandler);
        active = session;
        render(session);
        root.querySelector('.isbd-training-main').focus();
        return session;
    }

    global.ISBDTrainingWorkspace = { open, close: () => active && close(active), progressPayload };
})(window);
