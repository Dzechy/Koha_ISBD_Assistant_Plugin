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

                    if (parsed.signature === signature) {
                        progress.currentIndex = parsed.currentIndex || 0;
                    }
                }
            }
        } catch (err) {
            progress = { completed: {}, skipped: {}, currentIndex: 0, signature };
        }
        return progress;
    }

    function computeExpectedForRule(step, fieldContext, settings) {
        if (!fieldContext) return '';
        const result = global.ISBDRulesEngine.validateField(fieldContext, settings, [step.rule]);
        const relevant = result.findings.find(f => f.subfield === step.code && f.code === step.ruleId);
        if (relevant && relevant.expected_value) return relevant.expected_value;
        if (ruleAppliesToField(step.rule, fieldContext, step.code)) {
            const current = (fieldContext.subfields || []).find(sub => sub.code === step.code);
            return current && current.value ? current.value : '';
        }
        return '';
    }

    function computeGuideExample(step, $field, settings) {
        const stepExample = (step.examples && step.examples[0]) ? step.examples[0] : null;
        const ruleExample = getRuleExample(step.rule);
        let raw = '';
        let expected = '';
        if ($field && $field.length) {
            const meta = parseFieldMeta($field[0]);
            if (meta) {
                const fieldContext = buildFieldContext(meta.tag, meta.occurrence);
                if (fieldContext) {
                    const current = fieldContext.subfields.find(sub => sub.code === meta.code);
                    if (current && current.value) raw = current.value;
                    expected = computeExpectedForRule(step, fieldContext, settings);
                }
            }
        }
        if ((!expected || expected === raw) && stepExample) {
            raw = stepExample.before || raw;
            expected = stepExample.after || expected;
        } else if ((!expected || expected === raw) && ruleExample) {
            raw = ruleExample.before || raw;
            expected = ruleExample.after || expected;
        }
        if (!raw) raw = step.example_raw || '';
        if (!expected) expected = step.example_expected || '';
        if (!expected && raw) {
            const synthetic = {
                tag: step.tag,
                ind1: '',
                ind2: '',
                occurrence: '',
                subfields: [{ code: step.code, value: raw }]
            };
            expected = computeExpectedForRule(step, synthetic, settings);
        }
        if (!expected && raw) expected = raw;
        return { raw, expected };
    }

    function guideModuleForTag(tag) {
        if (!tag) return 'Other';
        if (['245', '246', '130', '240', '730'].includes(tag)) return 'Title & Statement (245/246)';
        if (tag === '250') return 'Edition (250)';
        if (tag === '260' || tag === '264') return 'Publication (260/264)';
        if (tag === '300') return 'Physical Description (300)';
        if (['440', '490', '800', '810', '811', '830'].includes(tag)) return 'Series (440/490/8xx)';
        if (/^(76|77|78)\d$/.test(tag)) return 'Linking Entries (76x-78x)';
        if (/^5\d\d$/.test(tag)) return 'Notes (5xx)';
        if (/^6\d\d$/.test(tag)) return 'Subjects (6xx)';
        if (/^7\d\d$/.test(tag)) return 'Added Entries (7xx)';
        if (/^1\d\d$/.test(tag)) return 'Main Entry Names (1xx)';
        if (/^0\d\d$/.test(tag)) return 'Identifiers (0xx)';
        return 'Other';
    }

    function guideModuleOrder() {
        return [
            'Title & Statement (245/246)',
            'Edition (250)',
            'Publication (260/264)',
            'Physical Description (300)',
            'Series (440/490/8xx)',
            'Notes (5xx)',
            'Subjects (6xx)',
            'Added Entries (7xx)',
            'Linking Entries (76x-78x)',
            'Main Entry Names (1xx)',
            'Identifiers (0xx)',
            'Other'
        ];
    }

    function buildGuideModules(steps) {
        const moduleMap = new Map();
        steps.forEach(step => {
            const module = step.module || guideModuleForTag(step.tag);
            step.module = module;
            if (!moduleMap.has(module)) moduleMap.set(module, []);
            moduleMap.get(module).push(step);
        });
        moduleMap.forEach(list => {
            list.sort(compareGuideSteps);
        });
        const order = guideModuleOrder();
        const modules = Array.from(moduleMap.keys()).sort((a, b) => {
            const ai = order.indexOf(a);
            const bi = order.indexOf(b);
            if (ai === -1 && bi === -1) return a.localeCompare(b);
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
        });
        return { modules, moduleMap };
    }

    function firstIncompleteIndex(steps, progress) {
        for (let i = 0; i < steps.length; i++) {
            if (!progress.completed[steps[i].key] && !(progress.skipped && progress.skipped[steps[i].key])) return i;
        }
        return Math.max(steps.length - 1, 0);
    }

    function saveGuideProgress(progress, settings, summary) {
        const key = getGuideProgressKey(settings);
        try {
            const serialized = JSON.stringify(progress);
            if (window.localStorage) {
                window.localStorage.setItem(key, serialized);
            } else if (window.sessionStorage) {
                window.sessionStorage.setItem(key, serialized);
            }
        } catch (err) {
            // ignore storage failures
        }
        sendGuideProgressUpdate(progress, settings, summary);
    }

    function sendGuideProgressUpdate(progress, settings, summary) {
        if (!settings || !settings.pluginPath) return;
        const completed = Object.keys(progress.completed || {});
        const skipped = Object.keys(progress.skipped || {});
        const summaryCounts = (() => {
            const completedCount = completed.length;
            const skippedCount = skipped.length;
            let total = completedCount + skippedCount;
            if (summary && typeof summary === 'object') {
                const explicitTotal = summary.steps_total || summary.total || summary.stepsTotal;
                if (Number.isFinite(explicitTotal)) total = explicitTotal;
            }
            return {
                completed_count: completedCount,
                skipped_count: skippedCount,
                total
            };
        })();
        const payload = {
            signature: progress.signature || '',
            completed,
            skipped,
            summary_counts: summaryCounts,
            summary: (summary && typeof summary === 'object') ? summary : {}
        };
        const buildGuideProgressUrl = (forceClass) => {
            const extraParams = { op: 'cud-plugin_api' };
            if (forceClass) extraParams.class = forceClass;
            return buildPluginUrl(settings, 'guide_progress_update', extraParams);
        };
        const url = buildGuideProgressUrl('');
        if (!url) return;

        if (global.ISBDApiClient && typeof global.ISBDApiClient.postJson === 'function') {
            global.ISBDApiClient.postJson(url, payload)
                .then(data => {
                    if (data && data.error) {
                        reportProgressUpdateError(settings, 200, data.error, '');
                    }
                    return data;
                })
                .catch(err => {
                    const message = err && err.message ? String(err.message) : 'Request failed.';
                    if (/missing required parameter:\s*class/i.test(message)) {
                        const fallbackClass = (settings.pluginClass || '').toString().trim();
                        const retryUrl = fallbackClass ? buildGuideProgressUrl(fallbackClass) : '';
                        if (retryUrl) {
                            global.ISBDApiClient.postJson(retryUrl, payload)
                                .catch(retryErr => {
                                    reportProgressUpdateError(settings, 0, (retryErr && retryErr.message) || message, '');
                                });
                            return;
                        }
                    }
                    reportProgressUpdateError(settings, 0, message, '');
                });
            return;
        }

        // Fallback path if API client module is unavailable.
        const normalizeCsrfToken = (value) => {
            if (value === undefined || value === null) return '';
            let token = String(value).replace(/[\r\n]/g, '').trim();
            return token;
        };
        let csrfToken = normalizeCsrfToken((settings && settings.csrfToken) || '');
        if (!csrfToken) {
            const csrfMetas = Array.from(document.querySelectorAll('meta[name="isbd-plugin-csrf-token"], meta[name="csrf-token"]'));
            csrfToken = csrfMetas
                .map(meta => normalizeCsrfToken(meta ? meta.getAttribute('content') : ''))
                .find(Boolean) || '';
        }
        const queryIndex = url.indexOf('?');
        const formBody = new URLSearchParams(queryIndex >= 0 ? url.slice(queryIndex + 1) : '');
        if (csrfToken) formBody.set('csrf_token', csrfToken);
        formBody.set('payload', JSON.stringify(payload));
        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Accept': 'application/json',
                ...(csrfToken ? { 'X-CSRF-Token': csrfToken, 'CSRF-TOKEN': csrfToken } : {})
            },
            credentials: 'include',
            body: formBody.toString()
        })
            .then(resp => resp.json())
            .then(data => {
                if (data && data.error) {
                    reportProgressUpdateError(settings, 200, data.error, '');
                }
            })
            .catch(err => {
                reportProgressUpdateError(settings, 0, err.message || 'Request failed.', '');
            });
    }

    function showGuide(settings) {
        const state = global.ISBDIntellisenseState;
        if (!state) return;
        try {
            state.guideActive = true;
            state.guideRefresh = null;
            state.guideCurrentStep = null;
            const stepSets = buildGuideStepSets(settings, state);
            const allSteps = stepSets.primary.concat(stepSets.secondary);
            const masterSignature = allSteps.map(step => step.key).join('|');
            let steps = stepSets.primary;
            let remainingSteps = stepSets.secondary;
            if (!steps.length && remainingSteps.length) {
                steps = remainingSteps;
                remainingSteps = [];
            }
            if (!steps.length) {
                state.guideActive = false;
                state.guideRefresh = null;
                state.guideCurrentStep = null;
                toast('warning', 'No ISBD rules found for this framework.');
                return;
            }
            const moduleData = buildGuideModules(allSteps);
            let activeModule = 'All';
            let stepIndex = 0;
            const progress = loadGuideProgress(allSteps, settings);
            progress.signature = masterSignature;
            stepIndex = firstIncompleteIndex(steps, progress);
            $('.isbd-guide-modal').remove();
            const modal = $(`
                <div class="isbd-guide-modal">
                    <header>
                        <span>ISBD Training Guide</span>
                        <div>
                            <button type="button" class="btn btn-xs isbd-btn-yellow" id="isbd-guide-reset">Reset</button>
                            <button type="button" class="btn btn-xs isbd-btn-yellow" id="isbd-guide-minimize">Minimize</button>
                            <button type="button" class="btn btn-xs isbd-btn-danger" id="isbd-guide-close">Close</button>
                        </div>
                    </header>
                    <div class="isbd-guide-content">
                        <div id="isbd-guide-progress" class="isbd-guide-progress"></div>
                        <div class="isbd-guide-module">
                            <label for="isbd-guide-module">Module:</label>
                            <select id="isbd-guide-module" class="form-control input-sm"></select>
                        </div>
                        <div id="isbd-guide-module-status" class="isbd-guide-progress"></div>
                        <div id="isbd-guide-overall-status" class="isbd-guide-progress"></div>
                        <div id="isbd-guide-body"></div>
                        <div id="isbd-guide-status" class="isbd-guide-status" style="margin-top: 8px; font-size: 12px;"></div>
                        <div class="isbd-guide-steps" id="isbd-guide-steps"></div>
                        <div style="margin-top: 12px; text-align: right;">
                            <button type="button" class="btn btn-xs isbd-btn-yellow" id="isbd-guide-example">Insert Input</button>
                            <button type="button" class="btn btn-xs btn-primary" id="isbd-guide-check">Check Step</button>
                            <button type="button" class="btn btn-xs btn-warning" id="isbd-guide-skip">Skip</button>
                            <button type="button" class="btn btn-xs isbd-btn-yellow" id="isbd-guide-prev">Prev</button>
                            <button type="button" class="btn btn-xs btn-primary" id="isbd-guide-next">Next</button>
                        </div>
                    </div>
                </div>
            `);
            $('body').append(modal);
            makeGuideDraggable();
            recoverFloatingPanel($('.isbd-guide-modal'), { minWidth: 320, minHeight: 220, right: 24, bottom: 24, buttonSelector: '#isbd-guide-minimize' });
            updateGuideToggleButton();
            const $moduleSelect = $('#isbd-guide-module');
            $moduleSelect.empty();
            $moduleSelect.append('<option value="All">All areas</option>');
            moduleData.modules.forEach(module => {
                $moduleSelect.append(`<option value="${escapeAttr(module)}">${module}</option>`);
            });
            $moduleSelect.val(activeModule);

        function getGuideField(step) {
            if (!step.tag || !step.code) return $();
            let $field = findFieldElement(step.tag, step.code, step.occurrence);
            step.activeTag = step.tag;
            if (!$field.length && Array.isArray(step.alternateTags)) {
                step.alternateTags.some(tag => {
                    const candidate = findFieldElement(tag, step.code, step.occurrence);
                    if (candidate.length) {
                        $field = candidate;
                        step.activeTag = tag;
                        return true;
                    }
                    return false;
                });
            }
            return $field;
        }

        function setActiveModule(moduleName) {
            if (!moduleName || moduleName === 'All') {
                activeModule = 'All';
                steps = stepSets.primary;
                remainingSteps = stepSets.secondary;
                if (!steps.length && remainingSteps.length) {
                    steps = remainingSteps;
                    remainingSteps = [];
                }
            } else {
                activeModule = moduleName;
                steps = moduleData.moduleMap.get(moduleName) || [];
                remainingSteps = [];
            }
            if (!steps.length) {
                toast('warning', 'No guide steps available for this module.');
                return;
            }
            stepIndex = firstIncompleteIndex(steps, progress);
            updateGuide();
        }

        function stepDone(step) {
            return !!(progress.completed[step.key] || progress.skipped[step.key]);
        }

        function stepSkipped(step) {
            return !!progress.skipped[step.key];
        }

        function countSteps(list) {
            const stats = { total: list.length, completed: 0, skipped: 0 };
            list.forEach(step => {
                if (progress.completed[step.key]) stats.completed++;
                if (progress.skipped[step.key]) stats.skipped++;
            });
            return stats;
        }

        function moduleCompletionSummary() {
            const modulesTotal = moduleData.modules.length;
            let modulesComplete = 0;
            moduleData.modules.forEach(module => {
                const list = moduleData.moduleMap.get(module) || [];
                const stats = countSteps(list);
                if (stats.total === 0 || (stats.completed + stats.skipped) >= stats.total) {
                    modulesComplete++;
                }
            });
            return { modulesTotal, modulesComplete };
        }

        function nextIncompleteModule() {
            if (activeModule === 'All') return '';
            const modules = moduleData.modules || [];
            if (!modules.length) return '';
            const startIndex = modules.indexOf(activeModule);
            const ordered = startIndex >= 0
                ? modules.slice(startIndex + 1).concat(modules.slice(0, startIndex + 1))
                : modules;
            for (const module of ordered) {
                if (module === activeModule) continue;
                const stats = countSteps(moduleData.moduleMap.get(module) || []);
                if (stats.total && (stats.completed + stats.skipped) < stats.total) return module;
            }
            return '';
        }

        function updateGuideStatus(message, type) {
            const $status = $('#isbd-guide-status');
            $status.removeClass('success error info').addClass(type || 'info');
            $status.text(message || '');
        }

        function maxUnlockedIndex() {
            let idx = 0;
            while (idx < steps.length && stepDone(steps[idx])) {
                idx++;
            }
            return Math.min(idx, steps.length - 1);
        }

        function completionTierFromPercent(percent) {
            let value = Number(percent || 0);
            if (!Number.isFinite(value)) value = 0;
            value = Math.round(value);
            if (value < 0) value = 0;
            if (value > 100) value = 100;
            if (value <= 33) return 'Tier 1';
            if (value <= 66) return 'Tier 2';
            return 'Tier 3';
        }

        function updateProgressUI() {
            const stats = countSteps(steps);
            const doneCount = stats.completed + stats.skipped;
            const percent = stats.total ? Math.round((doneCount / stats.total) * 100) : 0;
            const overallStats = countSteps(allSteps);
            const overallDone = overallStats.completed + overallStats.skipped;
            const overallPercent = overallStats.total ? Math.round((overallDone / overallStats.total) * 100) : 0;
            const completionTier = completionTierFromPercent(overallPercent);
            $('#isbd-guide-progress').html(
                `<div>${doneCount} of ${stats.total} steps complete (Skipped ${stats.skipped})</div>` +
                `<div class="isbd-progress-bar"><span style="width:${percent}%"></span></div>`
            );
            const moduleLabel = activeModule === 'All' ? 'All areas' : activeModule;
            $('#isbd-guide-module-status').text(`${moduleLabel}: ${doneCount}/${stats.total} steps complete (Skipped ${stats.skipped}).`);
            const moduleSummary = moduleCompletionSummary();
            const moduleText = `Modules complete: ${moduleSummary.modulesComplete}/${moduleSummary.modulesTotal} · Current tier: ${completionTier}`;
            $('#isbd-guide-overall-status').text(moduleText);
            updateModuleDropdown();
            if (moduleSummary.modulesTotal > 0 && moduleSummary.modulesComplete === moduleSummary.modulesTotal) {
                maybeShowGuideCompletionModal();
            }
        }

        function updateModuleDropdown() {
            $moduleSelect.find('option').each(function() {
                const value = $(this).attr('value');
                if (!value) return;
                let stats;
                if (value === 'All') {
                    stats = countSteps(allSteps);
                } else {
                    stats = countSteps(moduleData.moduleMap.get(value) || []);
                }
                const done = stats.completed + stats.skipped;
                const suffix = stats.total ? ` (${done}/${stats.total}, S${stats.skipped})` : ' (0/0)';
                const label = value === 'All' ? 'All areas' : value;
                $(this).text(`${label}${suffix}`);
            });
            $moduleSelect.val(activeModule);
        }

        function renderStepList() {
            const $list = $('#isbd-guide-steps');
            $list.empty();
            steps.forEach((step, index) => {
                const completed = !!progress.completed[step.key];
                const skipped = !!progress.skipped[step.key];
                const label = completed ? '✓' : (skipped ? 'S' : (index === stepIndex ? '→' : '•'));
                const btnClass = completed ? 'btn-success' : (skipped ? 'btn-warning' : 'btn-default');
                const btn = $(`<button type="button" class="btn btn-xs ${btnClass}">${label} ${step.title}</button>`);
                btn.on('click', () => {
                    const limit = maxUnlockedIndex();
                    if (index > limit) {
                        toast('warning', 'Complete the current step before jumping ahead.');
                        return;
                    }
                    stepIndex = index;
                    updateGuide();
                });
                $list.append(btn);
            });
        }

        function updateGuide() {
            const step = steps[stepIndex];
            state.guideCurrentStep = step;
            state.guideRefresh = updateGuide;
            const $field = getGuideField(step);
            const hasField = $field.length > 0;
            const ind1Label = (step.rule && step.rule.ind1 !== undefined && step.rule.ind1 !== null && step.rule.ind1 !== '') ? step.rule.ind1 : '*';
            const ind2Label = (step.rule && step.rule.ind2 !== undefined && step.rule.ind2 !== null && step.rule.ind2 !== '') ? step.rule.ind2 : '*';
            const indicatorNote = (step.rule && (step.rule.ind1 !== undefined || step.rule.ind2 !== undefined))
                ? `<div class="meta">Applies when ind1=${ind1Label}, ind2=${ind2Label}.</div>`
                : '';
            const missingNote = (!step.tag || !step.code || hasField) ? '' : '<div class="meta">Field not on the form. Use Add field to insert it before checking.</div>';
            const example = computeGuideExample(step, $field, settings);
            step.example_current = example;
            const exampleRawValue = (example.raw || step.example_raw || '').replace(/\s+$/, '');
            const exampleExpectedValue = (example.expected || step.example_expected || '').replace(/\s+$/, '');
            const exampleRaw = exampleRawValue || '(no sample input provided)';
            const exampleExpected = exampleExpectedValue || '(no sample output provided)';
            const treeHtml = (step.tree && step.tree.length)
                ? `<ul>${step.tree.map(item => `<li>${escapeAttr(item)}</li>`).join('')}</ul>`
                : '';
            const examplesHtml = (step.examples && step.examples.length)
                ? `<div><em>Examples:</em><ul>${step.examples.map(ex => `<li>${escapeAttr(ex.before || '')} → ${escapeAttr(ex.after || '')}</li>`).join('')}</ul></div>`
                : '';
            $('#isbd-guide-body').html(
                `<strong>${step.title}</strong><p>${step.text}</p>` +
                treeHtml +
                `<div><em>Example input:</em> ${escapeAttr(exampleRaw)}</div>` +
                `<div><em>Expected ISBD:</em> ${escapeAttr(exampleExpected)}</div>` +
                examplesHtml +
                indicatorNote +
                missingNote
            );
            $('#isbd-guide-prev').prop('disabled', stepIndex === 0);
            const canAdvance = stepDone(step);
            $('#isbd-guide-next').prop('disabled', !canAdvance);
            const atLastStep = stepIndex === steps.length - 1;
            const hasMoreSteps = remainingSteps.length > 0;
            const moduleSummary = moduleCompletionSummary();
            const allModulesDone = moduleSummary.modulesTotal > 0 && moduleSummary.modulesComplete === moduleSummary.modulesTotal;
            let nextLabel = 'Next';
            if (atLastStep) {
                if (activeModule === 'All') {
                    nextLabel = hasMoreSteps ? 'Continue' : 'Finish';
                } else {
                    nextLabel = allModulesDone ? 'Finish' : 'Next module';
                }
            }
            $('#isbd-guide-next').text(nextLabel);
            updateGuideStatus('', 'info');
            $('.isbd-guide-highlight').removeClass('isbd-guide-highlight');
            if ($field.length) {
                const tabId = findFieldTabId($field) || step.tab;
                if (tabId) {
                    activateTab(tabId);
                }
                $field.addClass('isbd-guide-highlight');
                $field.focus();
            }
            const checkable = !!step.rule && hasField;
            const allowMark = !step.rule;
            $('#isbd-guide-example').prop('disabled', !hasField);
            $('#isbd-guide-check')
                .prop('disabled', !(checkable || allowMark))
                .text(step.rule ? 'Check Step' : 'Mark Complete');
            $('#isbd-guide-skip').prop('disabled', stepDone(step));
            progress.currentIndex = stepIndex;
            saveGuideProgress(progress, settings, buildProgressSummary());
            updateProgressUI();
            renderStepList();
        }

        $('#isbd-guide-example').on('click', () => {
            const step = steps[stepIndex];
            focusField(step.activeTag || step.tag, step.code, step.occurrence);
            setTimeout(() => {
                const $field = getGuideField(step);
                if ($field.length) {
                    const example = step.example_current || computeGuideExample(step, $field, settings);
                    const inputValue = example.raw || step.example_raw;
                    if (!inputValue) {
                        updateGuideStatus('No sample input available for this step.', 'error');
                        return;
                    }
                    $field.val(inputValue);
                    runFieldValidation($field[0], settings, state, { apply: false });
                    updateGuideStatus('Input inserted. Make the ISBD corrections and then check.', 'info');
                }
            }, 220);
        });

        $('#isbd-guide-check').on('click', () => {
            const step = steps[stepIndex];
            if (!step.rule) {
                progress.completed[step.key] = true;
                delete progress.skipped[step.key];
                updateGuideStatus('Marked complete for this guidance step.', 'success');
                saveGuideProgress(progress, settings, buildProgressSummary());
                updateGuide();
                return;
            }
            const $field = getGuideField(step);
            if (!$field.length) {
                updateGuideStatus('Field not found on the form. Add the field before checking.', 'error');
                return;
            }
            if (!($field.val() || '').trim()) {
                updateGuideStatus('Field is empty. Enter a value before checking.', 'error');
                return;
            }
            const meta = parseFieldMeta($field[0]);
            if (!meta) return;
            const fieldContext = buildFieldContext(meta.tag, meta.occurrence);
            if (!fieldContext) return;
            const targetSub = fieldContext.subfields.find(sub => sub.code === meta.code);
            if (!targetSub) {
                updateGuideStatus('Target subfield not found. Insert a value before checking.', 'error');
                return;
            }
            if (!ruleAppliesToField(step.rule, fieldContext, meta.code)) {
                const ind1 = (step.rule && step.rule.ind1 !== undefined && step.rule.ind1 !== null && step.rule.ind1 !== '') ? step.rule.ind1 : '*';
                const ind2 = (step.rule && step.rule.ind2 !== undefined && step.rule.ind2 !== null && step.rule.ind2 !== '') ? step.rule.ind2 : '*';
                updateGuideStatus(`Indicators do not match this rule. Set ind1=${ind1}, ind2=${ind2} to continue.`, 'error');
                return;
            }
            const result = global.ISBDRulesEngine.validateField(fieldContext, settings, [step.rule]);
            const relevant = result.findings.filter(f => f.subfield === meta.code && f.code === step.ruleId);
            if (!relevant.length) {
                progress.completed[step.key] = true;
                delete progress.skipped[step.key];
                updateGuideStatus('Looks good. ISBD punctuation satisfied for this step.', 'success');
                toast('info', `${step.title}: ISBD punctuation looks good.`);
                saveGuideProgress(progress, settings, buildProgressSummary());
                updateGuide();
            } else {
                const example = computeGuideExample(step, $field, settings);
                const expected = (relevant[0].expected_value || example.expected || step.example_expected || '').replace(/\s+$/, '');
                const message = (relevant[0].message || '').replace(/\s+$/, '');
                const expectedText = expected ? ` Expected: ${expected}` : '';
                updateGuideStatus(`Needs attention: ${message}${expectedText}`, 'error');
                const expectedPreview = expected ? ` Expected: ${truncateToastText(expected, 120)}` : '';
                const messageSuffix = message ? (/[.!?]$/.test(message) ? '' : '.') : '';
                toast('warning', `Needs attention (${step.title}): ${message}${messageSuffix}${expectedPreview}`);
            }
        });

        $('#isbd-guide-prev').on('click', () => {
            if (stepIndex > 0) {
                stepIndex--;
                updateGuide();
            }
        });
        $('#isbd-guide-next').on('click', () => {
            if (!stepDone(steps[stepIndex])) {
                toast('warning', 'Check the current step before continuing.');
                return;
            }
            if (stepIndex < steps.length - 1) {
                stepIndex++;
                updateGuide();
            } else if (remainingSteps.length && activeModule === 'All') {
                const proceed = confirm('Continue with additional ISBD training steps?');
                if (!proceed) {
                    closeGuide();
                    return;
                }
                steps = steps.concat(remainingSteps);
                remainingSteps = [];
                stepIndex = Math.min(stepIndex + 1, steps.length - 1);
                saveGuideProgress(progress, settings, buildProgressSummary());
                updateGuide();
            } else if (activeModule !== 'All') {
                const nextModule = nextIncompleteModule();
                if (nextModule) {
                    setActiveModule(nextModule);
                    return;
                }
                closeGuide();
            } else {
                closeGuide();
            }
        });
        $('#isbd-guide-reset').on('click', () => {
            progress.completed = {};
            progress.skipped = {};
            progress.currentIndex = 0;
            saveGuideProgress(progress, settings, buildProgressSummary());
            stepIndex = 0;
            updateGuide();
        });
        $('#isbd-guide-skip').on('click', () => {
            const step = steps[stepIndex];
            progress.skipped[step.key] = true;
            delete progress.completed[step.key];
            updateGuideStatus('Step skipped. You can continue.', 'info');
            saveGuideProgress(progress, settings, buildProgressSummary());
            updateGuide();
        });
        $moduleSelect.on('change', () => {
            const selection = $moduleSelect.val() || 'All';
            setActiveModule(selection);
        });
        $('#isbd-guide-minimize').on('click', () => {
            const $modal = $('.isbd-guide-modal');
            setGuideMinimized($modal, !$modal.hasClass('minimized'));
        });
        $('#isbd-guide-close').on('click', () => closeGuide());

        function closeGuide() {
            state.guideActive = false;
            state.guideRefresh = null;
            state.guideCurrentStep = null;
            $(document).off('mousemove.isbdguideDrag mouseup.isbdguideDrag');
            $('.isbd-guide-modal').remove();
            $('.isbd-guide-highlight').removeClass('isbd-guide-highlight');
            updateGuideToggleButton();
        }

        function buildProgressSummary() {
            const overall = countSteps(allSteps);
            const moduleSummary = {};
            moduleData.modules.forEach(module => {
                moduleSummary[module] = countSteps(moduleData.moduleMap.get(module) || []);
            });
            const modules = moduleCompletionSummary();
            const currentStep = (steps && steps.length && steps[stepIndex]) ? steps[stepIndex] : null;
            const doneCount = overall.completed + overall.skipped;
            const completionPercent = overall.total ? Math.round((doneCount / overall.total) * 100) : 0;
            const currentTier = completionTierFromPercent(completionPercent);
            return {
                steps_total: overall.total,
                steps_completed: overall.completed,
                steps_skipped: overall.skipped,
                completion_percent: completionPercent,
                current_module: currentStep && currentStep.module ? currentStep.module : '',
                current_tier: currentTier,
                current_step_key: currentStep && currentStep.key ? currentStep.key : '',
                current_step_title: currentStep && currentStep.title ? currentStep.title : '',
                modules_total: modules.modulesTotal,
                modules_completed: modules.modulesComplete,
                module_breakdown: moduleSummary
            };
        }

        function maybeShowGuideCompletionModal() {
            const key = `isbdGuideCongrats:${progress.signature || 'default'}`;
            if (sessionStorage.getItem(key)) return;
            sessionStorage.setItem(key, '1');
            const modal = $(`
                <div class="isbd-guide-backdrop"></div>
                <div class="isbd-about-modal">
                    <h4 style="margin-top:0;">Training Complete</h4>
                    <p>Great work! You have completed all available ISBD training modules for this record.</p>
                    <div style="text-align: right;">
                        <button type="button" class="btn btn-xs btn-default" id="isbd-guide-congrats-close">Close</button>
                    </div>
                </div>
            `);
            $('body').append(modal);
            $('#isbd-guide-congrats-close').on('click', () => {
                $('.isbd-about-modal, .isbd-guide-backdrop').remove();
            });
        }

            updateGuide();
        } catch (err) {
            state.guideActive = false;
            state.guideRefresh = null;
            state.guideCurrentStep = null;
            updateGuideToggleButton();
            toast('error', 'Unable to open the training guide. See console for details.');
            console.error('[ISBD Assistant] Guide error:', err);
        }
    }

    function showAboutModal(settings) {
        $('.isbd-about-modal, .isbd-guide-backdrop').remove();
        const modal = $(`
            <div class="isbd-guide-backdrop"></div>
            <div class="isbd-about-modal isbd-about-dialog">
                <header>
                    <span>About Koha_ISBD_Cataloging_Assistant</span>
                    <div>
                        <button type="button" class="btn btn-xs isbd-btn-danger" id="isbd-about-close">Close</button>
                    </div>
                </header>
                <div class="body">
                    <p>ISBD-focused MARC21 assistant for Koha with guardrails, training guidance, and optional AI suggestions.</p>
                    <ul>
                        <li>ISBD punctuation checks and quick fixes</li>
                        <li>Cataloging guide progress tracking</li>
                        <li>Optional AI suggestions for classification and subjects</li>
                    </ul>
                    <p><strong>Author:</strong> Duke Chijimaka Jonathan, University of Port Harcourt, Nigeria</p>
                    <p><strong>Email:</strong> djonathan002@uniport.edu.ng</p>
                    <p><strong>LinkedIn:</strong> <a href="https://linkedin.com/in/duke-j-a1a9b0260" target="_blank" rel="noopener">linkedin.com/in/duke-j-a1a9b0260</a></p>
                    <p><strong>Plugin GitHub:</strong> <a href="https://github.com/build-with-duke/Koha_ISBD_Assistant_Plugin/" target="_blank" rel="noopener">github.com/Dzechy/Koha_ISBD_Assistant_Plugin</a></p>
                    <p><strong>Acknowledgements:</strong></p>
                    <ul class="isbd-ack-list">
                        <li>Prof. Helen Uzoezi Emasealu (helen.emasealu@uniport.edu.ng)</li>
                        <li>Dr. Millie Nne Horsfall (millie.horsfall@uniport.edu.ng)</li>
                        <li>Mr. Stanislaus Richard Ezeonye (stanislaus.ezeonye@uniport.edu.ng)</li>
                    </ul>
                    <p><strong>AI provider:</strong> ${settings.llmApiProvider || 'OpenRouter'}</p>
                    <p><strong>Model:</strong> ${settings.aiModel || 'Not set'}</p>
                    <hr/>
                    <h5 style="margin: 0 0 6px;">Buy Me a Coffee</h5>
                    <p style="margin-bottom: 8px;">If this plugin saved you from one more ISBD MARC rules headache, coffee keeps the devs and fixes coming.</p>
                    <p><a href="https://selfany.com/kohaISBDplugindonation" target="_blank" rel="noopener">Non-crypto donation link</a></p>
                    <div class="meta" style="margin-top: 6px;">Crypto:</div>
                    <ul class="isbd-ack-list" style="margin-top: 6px;">
                        <li>BTC: <code>19JSzRPB5qp3TKZVBeVUR8xmgntxKui5cc</code></li>
                        <li>ETH (ERC20): <code>0x5cc9f67d0f8328a46b9f9e12a1cfbf1a379e5947</code></li>
                        <li>USDT (ERC20): <code>0x5cc9f67d0f8328a46b9f9e12a1cfbf1a379e5947</code></li>
                        <li>USDC (ERC20): <code>0x5cc9f67d0f8328a46b9f9e12a1cfbf1a379e5947</code></li>
                        <li>LTC: <code>LesDgPh9BVp8SgbXqk8GbyCzHwnrgn7tDv</code></li>
                    </ul>
                </div>
            </div>
        `);
        $('body').append(modal);
        makeAboutDialogDraggable();
        const $about = $('.isbd-about-dialog');
        $about.show();
        recoverFloatingPanel($about, { minWidth: 320, minHeight: 220, right: 24, bottom: 24 });
        updateAboutToggleButton();
        $('#isbd-about-close').on('click', () => {
            $('.isbd-about-dialog, .isbd-guide-backdrop').remove();
            updateAboutToggleButton();
        });
    }

    function activateTab(tabId) {
        const selector = `a[href="#${tabId}"], a[data-bs-target="#${tabId}"]`;
        const $tab = $(selector).first();
        if (!$tab.length) return;
        if (global.bootstrap && global.bootstrap.Tab) {
            new global.bootstrap.Tab($tab[0]).show();
            return;
        }
        if ($tab.tab) {
            $tab.tab('show');
            return;
        }
        $tab.trigger('click');
    }

    global.ISBDIntellisenseTestHooks = {
        buildTitleSourceFromParts,
        filterCatalogingSubfields,
        parseAiSubjects,
        parseAiClassification,
        buildPluginUrl
    };
    global.ISBDIntellisenseUI = { init: initUI };
})(window, window.jQuery);
