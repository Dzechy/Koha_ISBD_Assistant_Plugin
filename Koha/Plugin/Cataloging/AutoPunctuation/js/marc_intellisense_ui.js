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

(function(global, $) {
    'use strict';

    function initUI(settings) {
        const path = (window.location && window.location.pathname ? String(window.location.pathname) : '').toLowerCase();
        if (!path.includes('/cataloguing/addbiblio.pl')) {
            return;
        }
        const state = {
            rules: [],
            findings: new Map(),
            aiFindings: [],
            missingRequired: [],
            guardrailAlerts: [],
            requiredFieldsConfigured: parseList(settings.requiredFields),
            requiredFields: parseList(settings.requiredFields),
            excludedTags: parseList(settings.excludedTags),
            localAllowlist: parseList(settings.localFieldsAllowlist),
            redactionRules: parseList(settings.aiRedactionRules),
            strictCoverage: settings.strictCoverageMode,
            autoApply: settings.autoApplyPunctuation,
            aiConfigured: settings.aiConfigured,
            aiConfidenceThreshold: settings.aiConfidenceThreshold || 0.85,
            undoStack: [],
            redoStack: [],
            guideActive: false,
            ignoredFindings: new Set(),
            revalidateAfterApply: new Set(),
            punctuationProvenance: new WeakMap(),
            ruleDependencies: new Map(),
            statementCaseTimers: new Map(),
            aiSubjectHistory: {},
            guideCurrentStep: null,
            guideRefresh: null,
            lastFocusedField: null,
            aiSuggestions: { classification: '', subjects: [], confidence: null, rationale: { ai: '', system: '' }, errors: [], authorityStatus: 'unverified', evidenceVerification: null, requiresHumanReview: true, status: '', parseStatus: '', authorityLookupStatus: '' },
            aiPunctuation: { findings: [], patches: [], summary: '', meta: null },
            lastChangeMeta: null,
            lastChangeAt: 0,
            validationLocks: new Set(),
            aiRequestCounter: 0,
            aiRequests: {
                punctuation: { id: 0, inFlight: false, status: '', statusType: 'info' },
                cataloging: { id: 0, inFlight: false, status: '', statusType: 'info' }
            }
        };
        global.ISBDIntellisenseState = state;

        const userContext = getUserContext(settings);
        state.userContext = userContext;
        if (userContext.internExcluded) {
            if (!userContext.internAccess.autoapplyToggle) {
                settings.autoApplyPunctuation = false;
                state.autoApply = false;
            }
            state.readOnly = !(userContext.internAccess.panelApplyActions || userContext.internAccess.aiApplyActions);
        }

        const rules = global.ISBDRulesEngine.loadRules(global.ISBDRulePack || {}, settings.customRules || '{}');
        state.rules = rules;
        state.ruleDependencies = buildRuleDependencies(rules);
        if (global.ISBDRulesEngine) {
            global.ISBDRulesEngine.onWarning = message => toast('warning', message);
        }

        injectStyles();
        addToolbar(settings, state, userContext);
        addSidePanel(settings, state);
        if (userContext.internExcluded && !userContext.internAccess.catalogingPanel) {
            $('.isbd-panel').hide();
        }
        makePanelDraggable();
        bindFieldHandlers(settings, state);
        bindPanelInteractionGuards();
        bindFormHandlers(settings, state);
        updateGuardrails(settings, state);
        setTimeout(() => refreshAll(settings), 250);
        attachCopyCatalogObserver(settings, state);
    }

    function parseList(value) {
        if (!value) return [];
        return value.split(',').map(item => item.trim()).filter(Boolean);
    }

    function settingBool(value, fallback) {
        if (value === undefined || value === null || value === '') return !!fallback;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        const text = String(value).trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(text)) return true;
        if (['0', 'false', 'no', 'off'].includes(text)) return false;
        return !!value;
    }

    function resolveInternAccess(settings, internExcluded) {
        const defaults = {
            assistantToggle: false,
            autoapplyToggle: false,
            catalogingPanel: true,
            aiAssistToggle: false,
            panelApplyActions: false,
            aiCataloging: false,
            aiPunctuation: false,
            aiApplyActions: false
        };
        if (!internExcluded) {
            return {
                assistantToggle: true,
                autoapplyToggle: true,
                catalogingPanel: true,
                aiAssistToggle: true,
                panelApplyActions: true,
                aiCataloging: true,
                aiPunctuation: true,
                aiApplyActions: true
            };
        }
        return {
            assistantToggle: settingBool(settings.internAllowAssistantToggle, defaults.assistantToggle),
            autoapplyToggle: settingBool(settings.internAllowAutoapplyToggle, defaults.autoapplyToggle),
            catalogingPanel: settingBool(settings.internAllowCatalogingPanel, defaults.catalogingPanel),
            aiAssistToggle: settingBool(settings.internAllowAiAssistToggle, defaults.aiAssistToggle),
            panelApplyActions: settingBool(settings.internAllowPanelApplyActions, defaults.panelApplyActions),
            aiCataloging: settingBool(settings.internAllowAiCataloging, defaults.aiCataloging),
            aiPunctuation: settingBool(settings.internAllowAiPunctuation, defaults.aiPunctuation),
            aiApplyActions: settingBool(settings.internAllowAiApplyActions, defaults.aiApplyActions)
        };
    }

    function getUserContext(settings) {
        let loggedInUser = settings && settings.currentUserId ? String(settings.currentUserId).trim() : '';
        if (!loggedInUser) {
            const selectors = [
                '#logged-in-info-full [class*="loggedinusernam"]',
                '#logged-in-info [class*="loggedinusernam"]',
                '#loggedinuser',
                '[class*="loggedinusernam"]'
            ];
            for (const selector of selectors) {
                const $candidate = $(selector).first();
                if ($candidate.length) {
                    loggedInUser = $candidate.text().trim();
                    if (loggedInUser) break;
                }
            }
        }
        const guideExclusions = parseList(`${settings.guideUsers || ''},${settings.guideExclusionList || ''}`);
        const internExclusions = parseList(`${settings.internshipUsers || ''},${settings.internshipExclusionList || ''}`);
        const internExcluded = settings.internshipMode && internExclusions.includes(loggedInUser);
        return {
            user: loggedInUser,
            guideExcluded: guideExclusions.includes(loggedInUser),
            internExcluded,
            internAccess: resolveInternAccess(settings, internExcluded)
        };
    }

    function internFeatureAllowed(state, featureKey) {
        const context = state && state.userContext ? state.userContext : null;
        if (!context || !context.internExcluded) return true;
        const access = context.internAccess || {};
        if (!Object.prototype.hasOwnProperty.call(access, featureKey)) return false;
        return !!access[featureKey];
    }

    function debug(settings, message) {
        if (settings.debugMode) {
            console.log(`[ISBD Assistant] ${message}`);
        }
    }

    function buildPluginUrl(settings, methodName, extraParams) {
        const pluginPath = settings && settings.pluginPath ? String(settings.pluginPath) : '';
        if (!methodName) {
            const message = 'Plugin method is required.';
            if (settings && settings.debugMode) {
                throw new Error(message);
            }
            console.error(`[ISBD Assistant] ${message}`);
            return '';
        }
        const classFromPath = (rawPath) => {
            const value = (rawPath || '').toString();
            if (!value) return '';
            const qIndex = value.indexOf('?');
            if (qIndex < 0) return '';
            const parsed = new URLSearchParams(value.slice(qIndex + 1));
            return (parsed.get('class') || '').trim();
        };
        const fallbackClass = settings && settings.pluginClass ? String(settings.pluginClass) : '';
        const fallbackBasePath = settings && settings.pluginRunPath ? String(settings.pluginRunPath) : '/cgi-bin/koha/plugins/run.pl';
        let basePath = fallbackBasePath;
        let className = fallbackClass || classFromPath(settings && settings.pluginBasePath ? settings.pluginBasePath : '')
            || classFromPath(settings && settings.pluginToolPath ? settings.pluginToolPath : '');

        if (pluginPath) {
            const qIndex = pluginPath.indexOf('?');
            const query = qIndex >= 0 ? pluginPath.slice(qIndex + 1) : '';
            basePath = qIndex >= 0 ? (pluginPath.slice(0, qIndex) || basePath) : pluginPath;
            const parsed = new URLSearchParams(query);
            className = (parsed.get('class') || className || '').trim();
        }
        if (!className) {
            const message = 'Plugin class is required for plugin dispatch.';
            if (settings && settings.debugMode) {
                throw new Error(message);
            }
            console.error(`[ISBD Assistant] ${message}`);
            return '';
        }

        const params = new URLSearchParams();
        params.set('class', className);
        params.set('method', methodName);
        if (extraParams && typeof extraParams === 'object') {
            Object.keys(extraParams).forEach(key => {
                const value = extraParams[key];
                if (value === undefined || value === null || value === '') return;
                params.set(key, String(value));
            });
        }
        const finalUrl = `${basePath}?${params.toString()}`;
        if (settings && settings.debugMode) {
            console.debug('[ISBD Assistant] Plugin dispatch URL:', finalUrl);
        }
        return finalUrl;
    }

    function reportProgressUpdateError(settings, status, message, bodySnippet) {
        const statusLabel = status ? `HTTP ${status}` : 'HTTP error';
        const detail = message ? message.replace(/\s+/g, ' ').slice(0, 180) : '';
        const summary = detail ? `${statusLabel}: ${detail}` : statusLabel;
        toast('error', `Training progress update failed (${summary}).`);
        if (settings && settings.debugMode) {
            const snippet = bodySnippet ? bodySnippet.replace(/\s+/g, ' ').slice(0, 400) : '';
            console.error('[ISBD Assistant] Guide progress update error:', summary, snippet);
        }
    }

    function sanitizeServerMessage(text) {
        return (text || '')
            .toString()
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 180);
    }

    function getAiRequestState(state, context) {
        if (!state) return null;
        if (!state.aiRequests) state.aiRequests = {};
        if (!state.aiRequests[context]) {
            state.aiRequests[context] = { id: 0, inFlight: false, status: '', statusType: 'info', controller: null };
        }
        return state.aiRequests[context];
    }

    function createAbortController() {
        if (typeof AbortController === 'undefined') return null;
        return new AbortController();
    }

    function cancelAiRequest(state, context, reason, silent) {
        const req = getAiRequestState(state, context);
        if (!req || !req.inFlight) return false;
        if (req.controller && typeof req.controller.abort === 'function') {
            try {
                req.controller.abort();
            } catch (err) {
                // ignore abort errors
            }
        }
        req.inFlight = false;
        req.controller = null;
        if (!silent) {
            const message = reason || 'Cancelled.';
            setAiRequestStatus(state, context, message, 'warning');
        }
        updateAiCancelButtonState(state);
        return true;
    }

    function isLatestAiRequest(state, context, requestId) {
        const req = getAiRequestState(state, context);
        return !!(req && req.id === requestId);
    }

    function startAiRequest(state, context) {
        if (!state) return 0;
        const req = getAiRequestState(state, context);
        if (req && req.inFlight) {
            cancelAiRequest(state, context, null, true);
        }
        const nextId = (state.aiRequestCounter || 0) + 1;
        state.aiRequestCounter = nextId;
        if (req) {
            req.id = nextId;
            req.inFlight = true;
            req.controller = createAbortController();
        }
        updateAiCancelButtonState(state);
        return nextId;
    }

    function finishAiRequest(state, context, requestId) {
        const req = getAiRequestState(state, context);
        if (!req || req.id !== requestId) return false;
        req.inFlight = false;
        req.controller = null;
        updateAiCancelButtonState(state);
        return true;
    }

    function getAiRequestSignal(state, context, requestId) {
        const req = getAiRequestState(state, context);
        if (!req || req.id !== requestId) return null;
        return req.controller ? req.controller.signal : null;
    }

    function isAbortError(err) {
        if (!err) return false;
        if (err.name === 'AbortError') return true;
        return String(err.message || '').toLowerCase().includes('aborted');
    }

    function setAiRequestStatus(state, context, message, type) {
        const req = getAiRequestState(state, context);
        if (!req) return;
        req.status = message || '';
        req.statusType = type || 'info';
    }

    function updateAiCancelButtonState(state) {
        const $panel = $('#isbd-ai-panel');
        if (!$panel.length) return;
        const punctuation = getAiRequestState(state, 'punctuation');
        const cataloging = getAiRequestState(state, 'cataloging');
        const punctInFlight = !!(punctuation && punctuation.inFlight);
        const catInFlight = !!(cataloging && cataloging.inFlight);
        const inFlight = punctInFlight || catInFlight;
        const $cancelButton = $panel.find('#isbd-ai-panel-cancel');
        if ($cancelButton.length) {
            $cancelButton.toggle(inFlight).prop('disabled', !inFlight);
        }
        const $punctCancel = $panel.find('#isbd-ai-cancel-punctuation');
        if ($punctCancel.length) {
            $punctCancel.toggle(punctInFlight).prop('disabled', !punctInFlight);
        }
        const $catalogingCancel = $panel.find('#isbd-ai-cancel-cataloging');
        if ($catalogingCancel.length) {
            $catalogingCancel.toggle(catInFlight).prop('disabled', !catInFlight);
        }
    }

    function applyStoredAiStatus($panel, state) {
        if (!$panel || !$panel.length) return;
        const punctuation = getAiRequestState(state, 'punctuation');
        if (punctuation && punctuation.status) {
            updateAiPanelStatus($panel, punctuation.status, punctuation.statusType);
        }
        const cataloging = getAiRequestState(state, 'cataloging');
        if (cataloging && cataloging.status) {
            updateAiCatalogingStatus($panel, cataloging.status, cataloging.statusType);
        }
    }

    function notifyTruncation(result) {
        const errors = result && Array.isArray(result.errors) ? result.errors : [];
        const warning = errors.find(err => err && err.code === 'OUTPUT_TRUNCATED');
        if (warning) {
            toast('warning', warning.message || 'Output truncated. Increase max output tokens or reduce reasoning effort.');
        }
    }

    function injectStyles() {
        if ($('#isbd-intellisense-styles').length) return;
        const styles = `
            .isbd-indicator { display: inline-block; margin-left: 6px; font-size: 11px; padding: 2px 6px; border-radius: 10px; }
            .isbd-indicator.info { background: #eaf3ff; color: #245f8f; }
            .isbd-indicator.warning { background: #fff3cd; color: #7a6000; }
            .isbd-indicator.error { background: #f8d7da; color: #a94442; }
            .isbd-ghost-text { color: #9aa7b8; font-style: italic; margin-left: 6px; cursor: pointer; }
            .isbd-toast { position: fixed; right: 20px; bottom: 20px; z-index: 10000; min-width: 250px; max-width: 420px; padding: 12px 14px; border-radius: 6px; margin-top: 10px; color: #1f2937; font-size: 12px; line-height: 1.45; box-shadow: 0 6px 12px rgba(0,0,0,0.2); border-left: 5px solid transparent; border-top: 2px solid transparent; }
            .isbd-toast.info { background: #eef5ff; border-left-color: #2f6f9f; border-top-color: #2f6f9f; color: #1f3d5a; }
            .isbd-toast.warning { background: #fff8e1; border-left-color: #f0c419; border-top-color: #f0c419; color: #5f4b00; }
            .isbd-toast.error { background: #fdeaea; border-left-color: #b33a3a; border-top-color: #b33a3a; color: #7f1d1d; }
            .isbd-toast.action { background: #eaf6ea; border-left-color: #408540; border-top-color: #408540; color: #1f5b1f; }
            .isbd-toast.success { background: #eaf6ea; border-left-color: #408540; border-top-color: #408540; color: #1f5b1f; }
            .isbd-panel { position: fixed; right: 20px; top: 120px; width: 610px; height: 670px; max-height: calc(100vh - 24px); background: #ffffff; border: 1px solid #d1d9e0; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.15); border-radius: 6px; z-index: 9998; display: flex; flex-direction: column; resize: both; overflow: auto; min-width: 280px; min-height: 180px; }
            .isbd-panel header { padding: 10px 12px; background: #408540; color: #fff; font-weight: 700; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px; cursor: move; }
            .isbd-panel header > div,
            .isbd-ai-panel header > div,
            .isbd-guide-modal header > div,
            .isbd-about-dialog header > div { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: flex-end; margin-left: auto; }
            .isbd-panel header .btn,
            .isbd-ai-panel header .btn,
            .isbd-guide-modal header .btn,
            .isbd-about-dialog header .btn { background: #eef3f8; border-color: #c8d4e2; color: #2b3b4d; font-weight: 400; }
            .isbd-panel header .btn:hover,
            .isbd-ai-panel header .btn:hover,
            .isbd-guide-modal header .btn:hover,
            .isbd-about-dialog header .btn:hover { background: #e4ebf2; border-color: #bcc9d8; color: #243445; }
            .isbd-btn-danger,
            .isbd-panel header .isbd-btn-danger,
            .isbd-ai-panel header .isbd-btn-danger,
            .isbd-guide-modal header .isbd-btn-danger { background: #b85454 !important; border-color: #a34848 !important; color: #fff !important; }
            .isbd-btn-danger:hover,
            .isbd-panel header .isbd-btn-danger:hover,
            .isbd-ai-panel header .isbd-btn-danger:hover,
            .isbd-guide-modal header .isbd-btn-danger:hover { background: #a24848 !important; border-color: #8e3e3e !important; color: #fff !important; }
            .isbd-btn-yellow { background: #f0c419 !important; border-color: #d7ad10 !important; color: #1f2937 !important; }
            .isbd-btn-yellow:hover { background: #e4b80f !important; border-color: #c99f05 !important; color: #1f2937 !important; }
            .isbd-panel .btn-default,
            .isbd-panel .btn-info,
            .isbd-ai-panel .btn-default,
            .isbd-ai-panel .btn-info,
            .isbd-guide-modal .btn-default,
            .isbd-guide-modal .btn-info { background: #eef3f8; border-color: #c8d4e2; color: #2b3b4d; }
            .isbd-panel .btn-default:hover,
            .isbd-panel .btn-info:hover,
            .isbd-ai-panel .btn-default:hover,
            .isbd-ai-panel .btn-info:hover,
            .isbd-guide-modal .btn-default:hover,
            .isbd-guide-modal .btn-info:hover { background: #e4ebf2; border-color: #bcc9d8; color: #243445; }
            .isbd-panel .btn-warning,
            .isbd-ai-panel .btn-warning,
            .isbd-guide-modal .btn-warning { background: #f0c419; border-color: #d7ad10; color: #1f2937; }
            .isbd-panel .btn-warning:hover,
            .isbd-ai-panel .btn-warning:hover,
            .isbd-guide-modal .btn-warning:hover { background: #e4b80f; border-color: #c99f05; color: #1f2937; }
            .isbd-panel .btn-primary,
            .isbd-ai-panel .btn-primary,
            .isbd-guide-modal .btn-primary { background: #408540; border-color: #2d6f2d; color: #fff; }
            .isbd-panel .btn-primary:hover,
            .isbd-ai-panel .btn-primary:hover,
            .isbd-guide-modal .btn-primary:hover { background: #377637; border-color: #2a622a; color: #fff; }
            .isbd-panel .body { padding: 14px 16px; overflow-y: auto; font-size: 12px; }
            .isbd-panel.minimized { min-height: 0; height: auto; resize: none; overflow: hidden; }
            .isbd-panel.minimized .body { display: none; }
            .isbd-panel .finding { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; margin-bottom: 10px; cursor: default; }
            .isbd-panel .finding .meta { font-size: 11px; color: #5b6b7c; margin-top: 4px; }
            .isbd-panel .finding.error { border-left: 4px solid #d9534f; }
            .isbd-panel .finding.warning { border-left: 4px solid #f0ad4e; }
            .isbd-panel .finding.info { border-left: 4px solid #5bc0de; }
            .isbd-panel .finding button { cursor: pointer; }
            .isbd-panel .finding .actions { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; }
            .isbd-help { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; border: 1px solid #94a3b8; color: #475569; font-size: 11px; margin-left: 6px; }
            .isbd-toolbar { background: #f5f7fb; border: 1px solid #dde3ea; padding: 8px 10px; border-radius: 6px; margin: 10px 0; }
            .isbd-toolbar .btn { margin-right: 6px; }
            .isbd-toolbar .btn.is-on { background: #408540; border-color: #2d6f2d; color: #fff; }
            .isbd-toolbar .btn.is-on:hover { background: #377637; border-color: #2a622a; color: #fff; }
            .isbd-toolbar .btn.isbd-disabled,
            .isbd-toolbar .btn.isbd-disabled:hover { background: #e5e7eb; border-color: #cbd5e1; color: #6b7280; cursor: not-allowed; }
            .isbd-preview { font-family: monospace; background: #f8fafc; padding: 4px 6px; border-radius: 4px; display: inline-block; margin-top: 6px; }
            .isbd-raw-wrapper { margin-top: 6px; }
            .isbd-raw-output { display: none; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px; font-size: 11px; max-height: 140px; overflow: auto; white-space: pre-wrap; }
            .isbd-ai-panel { position: fixed; right: 24px; bottom: 24px; width: 610px; height: 670px; background: #ffffff; border: 1px solid #d1d9e0; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.2); border-radius: 6px; z-index: 10002; display: flex; flex-direction: column; resize: both; overflow: auto; min-width: 300px; min-height: 200px; }
            .isbd-ai-panel header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px; cursor: move; padding: 8px 10px; background: #408540; color: #fff; font-weight: 700; }
            .isbd-ai-panel .body { padding: 14px 16px; font-size: 12px; }
            .isbd-ai-panel.minimized { min-height: 0; height: auto; resize: none; overflow: hidden; }
            .isbd-ai-panel.minimized .body { display: none; }
            .isbd-ai-panel .meta { color: #5b6b7c; font-size: 11px; margin-bottom: 6px; }
            .isbd-ai-field-value { font-family: monospace; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px; margin-top: 4px; white-space: pre-wrap; word-break: break-word; }
            .isbd-ai-text-output { font-family: monospace; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px; white-space: pre-wrap; word-break: break-word; max-height: 140px; overflow: auto; }
            .isbd-ai-text-output strong { font-weight: 700; color: #1f2937; }
            .isbd-ai-subject-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px dashed #dbe3ec; padding: 6px 0; }
            .isbd-ai-subject-row:last-child { border-bottom: none; }
            .isbd-ai-subject-label { flex: 1 1 auto; white-space: normal; word-break: break-word; }
            .isbd-ai-subject-apply { flex: 0 0 auto; }
            .isbd-ai-error { color: #a94442; font-weight: 600; margin-top: 4px; }
            .isbd-ai-debug { margin-top: 6px; }
            .isbd-ai-debug summary { cursor: pointer; font-weight: 600; color: #1f2937; }
            .isbd-ai-debug pre { margin: 6px 0 0 0; padding: 6px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; max-height: 180px; overflow: auto; white-space: pre-wrap; }
            .isbd-ai-results { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; margin-top: 8px; }
            .isbd-ai-result-item { border-bottom: 1px dashed #e2e8f0; padding: 8px 0; }
            .isbd-ai-result-item:last-child { border-bottom: none; }
            .isbd-ai-result-meta { color: #6b7280; font-size: 11px; margin-top: 2px; }
            .isbd-ai-result-actions { margin-top: 6px; display: flex; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
            .isbd-ai-result-checkbox { margin-right: 6px; }
            .isbd-ai-panel .options label { display: block; margin-top: 4px; font-weight: 400; }
            .isbd-ai-panel .actions { margin-top: 12px; display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
            .isbd-ai-section { border-bottom: 1px dashed #e2e8f0; padding-bottom: 12px; margin-bottom: 12px; }
            .isbd-ai-section:last-child { border-bottom: none; margin-bottom: 0; }
            .isbd-ai-section-title { font-weight: 700; font-size: 12px; margin-bottom: 6px; color: #212529; text-transform: uppercase; letter-spacing: 0.3px; }
            .isbd-ai-inline { display: flex; gap: 6px; align-items: center; margin-top: 4px; }
            .isbd-ai-inline input { flex: 1 1 auto; min-width: 160px; }
            .isbd-ai-prefix-options { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px 10px; }
            .isbd-ai-prefix-options label { margin: 0; font-weight: 400; display: inline-flex; align-items: center; gap: 4px; }
            .isbd-ai-list { padding-left: 18px; margin: 4px 0 0 0; }
            .isbd-ai-callnumber { margin-top: 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px; }
            .isbd-ai-callnumber-hints { margin-top: 12px; }
            .isbd-ai-callnumber-hints .meta { margin-bottom: 7px; }
            .isbd-ai-callnumber-hints .meta:last-child { margin-bottom: 0; }
            .isbd-guide-modal { position: fixed; top: 120px; right: 24px; left: auto; transform: none; background: #ffffff; border: 1px solid #d1d9e0; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.2); border-radius: 6px; padding: 0; z-index: 10001; width: 610px; height: 670px; resize: both; overflow: auto; min-width: 320px; min-height: 220px; max-height: calc(100vh - 24px); display: flex; flex-direction: column; }
            .isbd-guide-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 10000; }
            .isbd-guide-highlight { border: 2px solid #3b82f6 !important; box-shadow: 0 0 10px rgba(59,130,246,0.4) !important; }
            .isbd-focus-flash { border: 2px solid #408540 !important; box-shadow: 0 0 8px rgba(64,133,64,0.4) !important; }
            .isbd-about-modal { position: fixed; top: 22%; left: 50%; transform: translateX(-50%); background: #ffffff; border: 1px solid #d1d9e0; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.2); border-radius: 6px; padding: 14px; z-index: 10001; width: 420px; }
            .isbd-about-dialog { position: fixed; top: 14%; left: 50%; transform: translateX(-50%); background: #ffffff; border: 1px solid #d1d9e0; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.2); border-radius: 6px; padding: 0; z-index: 10003; width: 560px; max-width: 94vw; max-height: 82vh; overflow: auto; min-width: 320px; min-height: 220px; display: flex; flex-direction: column; resize: both; }
            .isbd-about-dialog header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px; cursor: move; padding: 8px 10px; background: #408540; color: #ffffff; font-weight: 700; }
            .isbd-about-dialog .body { padding: 12px 14px; font-size: 12px; }
            .isbd-ai-preview-modal { position: fixed; top: 18%; left: 50%; transform: translateX(-50%); background: #ffffff; border: 1px solid #d1d9e0; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.2); border-radius: 6px; padding: 14px; z-index: 10002; width: 520px; max-width: 90vw; max-height: 70vh; overflow: auto; }
            .isbd-ai-preview-modal pre { background: #f8fafc; padding: 8px; border-radius: 4px; font-size: 11px; white-space: pre-wrap; word-break: break-word; }
            .isbd-guide-modal.minimized .isbd-guide-content { display: none; }
            .isbd-guide-modal.minimized { min-height: 0; height: auto; resize: none; overflow: hidden; }
            .isbd-guide-modal header { display: flex; justify-content: space-between; align-items: center; cursor: move; padding: 8px 10px; background: #408540; color: #ffffff; font-weight: 700; }
            .isbd-guide-content { padding: 14px 16px; font-size: 12px; }
            .isbd-guide-steps { max-height: 160px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px; margin-top: 8px; }
            .isbd-guide-steps button { width: 100%; text-align: left; margin-bottom: 4px; }
            .isbd-guide-progress { margin-top: 8px; font-size: 12px; color: #5b6b7c; }
            .isbd-guide-module { margin-top: 8px; display: flex; align-items: center; gap: 6px; font-size: 12px; }
            .isbd-guide-module select { max-width: 260px; }
            .isbd-guide-status { display: inline-flex; align-items: center; gap: 6px; color: #5b6b7c; font-weight: 600; }
            .isbd-guide-status.success { color: #408540; }
            .isbd-guide-status.error { color: #c0392b; }
            .isbd-guide-status.info { color: #5b6b7c; }
            .isbd-status-text { font-weight: 600; color: #5b6b7c; display: inline-block; padding: 2px 8px; border-radius: 999px; background: #eef2f6; }
            .isbd-status-text.success { color: #2d6f2d; background: #e9f5ea; }
            .isbd-status-text.error { color: #a94442; background: #fbeaea; }
            .isbd-status-text.info { color: #245f8f; background: #eaf3ff; }
            .isbd-status-text.warning { color: #7a6000; background: #fff5cc; }
            .isbd-ai-status-row { margin-top: 6px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
            .isbd-progress-bar { height: 6px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
            .isbd-progress-bar span { display: block; height: 100%; background: #408540; }
            .isbd-about-modal .isbd-ack-list { margin: 6px 0 12px 18px; }
            .isbd-about-modal .isbd-ack-list li { margin-bottom: 4px; }
            .isbd-top-resize-handle { position: absolute; top: 0; left: 0; right: 0; height: 8px; cursor: n-resize; z-index: 4; }
            .isbd-panel.resizing,
            .isbd-ai-panel.resizing,
            .isbd-guide-modal.resizing,
            .isbd-about-dialog.resizing { user-select: none; }
            @media (max-width: 767px) {
                .isbd-panel,
                .isbd-ai-panel,
                .isbd-guide-modal,
                .isbd-about-dialog {
                    width: calc(100vw - 16px);
                    max-width: calc(100vw - 16px);
                    left: 8px !important;
                    right: 8px !important;
                    top: auto !important;
                    bottom: 8px !important;
                    max-height: 78vh;
                }
            }
        `;
        $('head').append(`<style id="isbd-intellisense-styles">${styles}</style>`);
    }

    function floatingPanelStorageKey($panel) {
        if (!$panel || !$panel.length) return '';
        const panelId = ($panel.attr('id') || '').trim();
        if (panelId) return `isbdFloating:${panelId}`;
        const className = (($panel.attr('class') || '').split(/\s+/).filter(Boolean)[0] || 'panel').trim();
        return `isbdFloating:${className}`;
    }

    function saveFloatingPanelState($panel) {
        if (!$panel || !$panel.length || !$panel[0] || !window.localStorage) return;
        const key = floatingPanelStorageKey($panel);
        if (!key) return;
        try {
            const node = $panel[0];
            const rect = node.getBoundingClientRect();
            const state = {
                width: node.style.width || `${Math.round(rect.width)}px`,
                height: node.style.height || `${Math.round(rect.height)}px`,
                left: node.style.left || '',
                top: node.style.top || '',
                right: node.style.right || '',
                bottom: node.style.bottom || '',
                minimized: $panel.hasClass('minimized') ? 1 : 0
            };
            window.localStorage.setItem(key, JSON.stringify(state));
        } catch (err) {
            // ignore storage failures
        }
    }

    function loadFloatingPanelState($panel, buttonSelector) {
        if (!$panel || !$panel.length || !$panel[0] || !window.localStorage) return;
        if ($panel.data('isbdStateLoaded')) return;
        $panel.data('isbdStateLoaded', 1);
        const key = floatingPanelStorageKey($panel);
        if (!key) return;
        try {
            const raw = window.localStorage.getItem(key);
            if (!raw) return;
            const stored = JSON.parse(raw);
            if (!stored || typeof stored !== 'object') return;
            if (stored.width) $panel.css('width', stored.width);
            if (stored.height) $panel.css('height', stored.height);
            if (stored.left || stored.top) {
                $panel.css({
                    right: 'auto',
                    bottom: 'auto'
                });
            }
            if (stored.left) $panel.css('left', stored.left);
            if (stored.top) $panel.css('top', stored.top);
            if (stored.right) $panel.css('right', stored.right);
            if (stored.bottom) $panel.css('bottom', stored.bottom);
            if (stored.minimized) {
                setFloatingMinimized($panel, 1, buttonSelector, { skipSave: true });
            }
        } catch (err) {
            // ignore corrupt state
        }
    }

    const toastState = { lastKey: '', lastAt: 0 };
    function toast(type, message) {
        const rawMessage = (message === undefined || message === null) ? '' : String(message);
        let normalizedType = (type || 'info').toString().toLowerCase();
        if (normalizedType === 'info' && /\b(applied|apply|inserted|ignored|undo|undone|redo|redone|saved|updated|cleared)\b/i.test(rawMessage)) {
            normalizedType = 'action';
        }
        if (!['info', 'warning', 'error', 'success', 'action'].includes(normalizedType)) {
            normalizedType = 'info';
        }
        const now = Date.now();
        const key = `${normalizedType}:${rawMessage}`;
        if (toastState.lastKey === key && (now - toastState.lastAt) < 2000) {
            return;
        }
        toastState.lastKey = key;
        toastState.lastAt = now;
        const $toast = $(`<div class="isbd-toast ${normalizedType}">${rawMessage}</div>`).appendTo('body');
        setTimeout(() => $toast.fadeOut(() => $toast.remove()), 4000);
    }

    function truncateToastText(text, maxLen) {
        const value = (text || '').toString();
        if (!maxLen || value.length <= maxLen) return value;
        return `${value.slice(0, Math.max(0, maxLen - 3))}...`;
    }

    function buildConditionalSuffixToast(finding) {
        if (!finding || !finding.condition || finding.condition.type !== 'conditional_suffix') return '';
        const condition = finding.condition;
        const following = Array.isArray(condition.following_subfields) ? condition.following_subfields : [];
        if (!following.length) return '';
        const tag = finding.tag || '';
        const fieldLabel = `${tag}$${finding.subfield}`;
        const list = following.map(code => `${tag}$${code}`).join(', ');
        if (condition.action === 'trim' && condition.has_following) {
            return `Trailing punctuation removed from ${fieldLabel} because ${list} is present.`;
        }
        if (condition.action === 'add' && !condition.has_following) {
            return `Terminal punctuation added to ${fieldLabel} because ${list} is missing.`;
        }
        return '';
    }

    function buildConditionalSuffixSuggestionToast(finding) {
        if (!finding || !finding.condition || finding.condition.type !== 'conditional_suffix') return '';
        const condition = finding.condition;
        const following = Array.isArray(condition.following_subfields) ? condition.following_subfields : [];
        if (!following.length) return '';
        const tag = finding.tag || '';
        const fieldLabel = `${tag}$${finding.subfield}`;
        const list = following.map(code => `${tag}$${code}`).join(', ');
        if (condition.has_following) {
            return `Update ${fieldLabel}: remove trailing punctuation because ${list} is present.`;
        }
        return `Update ${fieldLabel}: add terminal punctuation because ${list} is missing.`;
    }

    function buildConditionalSuffixNote(finding) {
        if (!finding || !finding.condition || finding.condition.type !== 'conditional_suffix') return '';
        const condition = finding.condition;
        const following = Array.isArray(condition.following_subfields) ? condition.following_subfields : [];
        if (!following.length) return '';
        const tag = finding.tag || '';
        const list = following.map(code => `${tag}$${code}`).join(', ');
        if (condition.action === 'trim' && condition.has_following) {
            return `Trailing punctuation removed because ${list} is present.`;
        }
        if (condition.action === 'add' && !condition.has_following) {
            return '';
        }
        const state = condition.has_following ? 'present' : 'missing';
        if (condition.has_following) {
            return `Punctuation depends on ${list} being ${state}.`;
        }
        return '';
    }

    function notifyDependentFindings(meta, findings, state) {
        if (!meta || !findings || !findings.length) return;
        const messages = new Set();
        const focusCode = (meta.code || '').toLowerCase();
        findings.forEach(finding => {
            if (!finding || !finding.condition || finding.condition.type !== 'conditional_suffix') return;
            if (focusCode && (finding.subfield || '').toLowerCase() === focusCode) return;
            const message = buildConditionalSuffixSuggestionToast(finding);
            if (message) messages.add(message);
        });
        messages.forEach(message => toast('info', message));
    }

    function notifyDependentFindingsAfterRefresh(state) {
        if (!state || !state.lastChangeMeta) return;
        if (!state.lastChangeAt || (Date.now() - state.lastChangeAt) > 2000) return;
        const meta = state.lastChangeMeta;
        if (!meta.tag) return;
        const combined = collectFindingsForField(state, meta.tag, meta.occurrence || '');
        notifyDependentFindings(meta, combined, state);
    }

    function addToolbar(settings, state, userContext) {
        if (!$('#cat_addbiblio, form[name="f"]').length) return;
        $('.isbd-toolbar').remove();
        const internAccess = (userContext && userContext.internAccess) ? userContext.internAccess : {};
        const guideButton = settings.enableGuide && !userContext.guideExcluded
            ? '<button type="button" class="btn btn-sm btn-default" id="isbd-guide">Guide</button>'
            : '';
        const aboutButton = '<button type="button" class="btn btn-sm btn-default" id="isbd-about">About</button>';
        const aiToggleDisabledAttr = (!settings.aiConfigured && !(userContext.internExcluded && !internAccess.aiAssistToggle)) ? 'disabled' : '';
        const toolbar = `
            <div class="isbd-toolbar">
                <button type="button" class="btn btn-sm btn-default ${settings.enabled ? 'is-on' : ''}" id="isbd-toggle">
                    ${settings.enabled ? 'ISBD Assistant ON' : 'ISBD Assistant OFF'}
                </button>
                <button type="button" class="btn btn-sm btn-default ${settings.autoApplyPunctuation ? 'is-on' : ''}" id="isbd-autoapply">
                    ${settings.autoApplyPunctuation ? 'Auto-apply fixes' : 'Suggest only'}
                </button>
                <button type="button" class="btn btn-sm btn-default" id="isbd-panel-toggle">Cataloging Assistant</button>
                <button type="button" class="btn btn-sm btn-default" id="isbd-ai-toggle" ${aiToggleDisabledAttr}>
                    AI Assist
                </button>
                ${guideButton}
                ${aboutButton}
                <span id="isbd-guardrail-status" style="margin-left: 6px; font-size: 12px; color: #5b6b7c;">Guardrails: pending</span>
            </div>
        `;
        const $target = $('#cat_addbiblio').length ? $('#cat_addbiblio') : $('form[name="f"]').first();
        $target.before(toolbar);

        $('#isbd-toggle').on('click', () => {
            if (userContext.internExcluded && !internAccess.assistantToggle) {
                toast('warning', 'ISBD Assistant toggle is disabled for this internship profile.');
                return;
            }
            settings.enabled = !settings.enabled;
            $('#isbd-toggle').toggleClass('is-on', !!settings.enabled)
                .text(settings.enabled ? 'ISBD Assistant ON' : 'ISBD Assistant OFF');
            toast('info', settings.enabled ? 'ISBD assistant enabled.' : 'ISBD assistant disabled.');
        });

        $('#isbd-autoapply').on('click', () => {
            if (userContext.internExcluded && !internAccess.autoapplyToggle) {
                toast('warning', 'Auto-apply toggle is disabled for this internship profile.');
                return;
            }
            settings.autoApplyPunctuation = !settings.autoApplyPunctuation;
            $('#isbd-autoapply').toggleClass('is-on', !!settings.autoApplyPunctuation)
                .text(settings.autoApplyPunctuation ? 'Auto-apply fixes' : 'Suggest only');
            state.autoApply = settings.autoApplyPunctuation;
            toast('info', settings.autoApplyPunctuation ? 'Auto-apply fixes enabled.' : 'Auto-apply fixes disabled.');
        });

        $('#isbd-panel-toggle').on('click', () => {
            if (userContext.internExcluded && !internAccess.catalogingPanel) {
                toast('warning', 'Cataloging Assistant panel is disabled for this internship profile.');
                return;
            }
            $('.isbd-panel').toggle();
            updatePanelToggleButton();
        });

        $('#isbd-ai-toggle').on('click', () => {
            if (userContext.internExcluded && !internAccess.aiAssistToggle) {
                toast('warning', 'AI Assist is disabled for selected interns in internship mode.');
                return;
            }
            if (!settings.aiConfigured) return;
            const $aiPanel = $('#isbd-ai-panel');
            if ($aiPanel.length && $aiPanel.is(':visible')) {
                $aiPanel.hide();
                if (state) state.aiPanelOpen = false;
                updateAiToggleButton();
                return;
            }
            showAiAssistPanel(settings, state);
        });

        if (userContext.internExcluded) {
            if (!internAccess.assistantToggle) {
                $('#isbd-toggle')
                    .removeClass('is-on')
                    .addClass('isbd-disabled')
                    .attr('aria-disabled', 'true')
                    .attr('title', 'Disabled in internship mode.');
            }
            if (!internAccess.autoapplyToggle) {
                $('#isbd-autoapply')
                    .removeClass('is-on')
                    .addClass('isbd-disabled')
                    .attr('aria-disabled', 'true')
                    .attr('title', 'Disabled in internship mode.');
            }
            if (!internAccess.catalogingPanel) {
                $('#isbd-panel-toggle')
                    .removeClass('is-on')
                    .addClass('isbd-disabled')
                    .attr('aria-disabled', 'true')
                    .attr('title', 'Disabled in internship mode.');
            }
            if (!internAccess.aiAssistToggle) {
                $('#isbd-ai-toggle')
                    .prop('disabled', false)
                    .removeClass('is-on')
                    .addClass('isbd-disabled')
                    .attr('aria-disabled', 'true')
                    .attr('title', 'Disabled in internship mode.');
            }
        }

        if (settings.enableGuide && !userContext.guideExcluded) {
            $(document).off('click.isbdguide', '#isbd-guide');
            $(document).on('click.isbdguide', '#isbd-guide', () => {
                const $modal = $('.isbd-guide-modal');
                if ($modal.length && $modal.is(':visible')) {
                    state.guideActive = false;
                    state.guideRefresh = null;
                    state.guideCurrentStep = null;
                    $(document).off('mousemove.isbdguideDrag mouseup.isbdguideDrag');
                    $modal.remove();
                    $('.isbd-guide-highlight').removeClass('isbd-guide-highlight');
                    updateGuideToggleButton();
                    return;
                }
                showGuide(settings);
                updateGuideToggleButton();
            });
        }
        $('#isbd-about').on('click', () => {
            if ($('.isbd-about-dialog').length) {
                $('.isbd-about-dialog, .isbd-guide-backdrop').remove();
                updateAboutToggleButton();
                return;
            }
            showAboutModal(settings);
            updateAboutToggleButton();
        });
        updateAiToggleButton();
        updateGuideToggleButton();
        updateAboutToggleButton();
    }

    function addSidePanel(settings, state) {
        if ($('.isbd-panel').length) return;
        const isReadOnly = !!(state && (state.readOnly || !internFeatureAllowed(state, 'panelApplyActions')));
        const readOnlyAttr = isReadOnly ? 'disabled title="Disabled in internship mode."' : '';
        const panel = `
            <div class="isbd-panel" style="display:block;">
                <header>
                    <span>Cataloging Assistant</span>
                    <div>
                        <button type="button" class="btn btn-xs isbd-btn-yellow" id="isbd-panel-applyall" ${readOnlyAttr}>Apply all</button>
                        <button type="button" class="btn btn-xs isbd-btn-yellow" id="isbd-panel-undo" ${readOnlyAttr}>Undo</button>
                        <button type="button" class="btn btn-xs isbd-btn-yellow" id="isbd-panel-redo" ${readOnlyAttr}>Redo</button>
                        <button type="button" class="btn btn-xs isbd-btn-yellow" id="isbd-panel-undoall" ${readOnlyAttr}>Undo all</button>
                        <button type="button" class="btn btn-xs isbd-btn-danger" id="isbd-panel-ignoreall">Ignore all</button>
                        <button type="button" class="btn btn-xs isbd-btn-yellow" id="isbd-panel-minimize">Minimize</button>
                        <button type="button" class="btn btn-xs isbd-btn-danger" id="isbd-panel-close">Close</button>
                    </div>
                </header>
                <div class="body">
                    <div class="meta">ISBD rules and punctuation findings appear here. Click Apply to accept suggestions.</div>
                    <div id="isbd-findings"></div>
                </div>
            </div>
        `;
        $('body').append(panel);
        attachTopResizeHandle($('.isbd-panel'), { minHeight: 180, namespace: 'isbdpanelTopResize' });
        $('#isbd-panel-close').on('click', () => {
            $('.isbd-panel').hide();
            updatePanelToggleButton();
        });
        $('#isbd-panel-minimize').on('click', () => {
            const $panel = $('.isbd-panel');
            setFloatingMinimized($panel, !$panel.hasClass('minimized'), '#isbd-panel-minimize');
        });
        $('#isbd-panel-applyall').on('click', () => {
            if (!internFeatureAllowed(state, 'panelApplyActions')) {
                toast('warning', 'Cataloging Assistant apply actions are disabled for this internship profile.');
                return;
            }
            applyAllFindings(settings);
        });
        $('#isbd-panel-undo').on('click', () => {
            if (!internFeatureAllowed(state, 'panelApplyActions')) {
                toast('warning', 'Cataloging Assistant apply actions are disabled for this internship profile.');
                return;
            }
            undoLastChange();
        });
        $('#isbd-panel-redo').on('click', () => {
            if (!internFeatureAllowed(state, 'panelApplyActions')) {
                toast('warning', 'Cataloging Assistant apply actions are disabled for this internship profile.');
                return;
            }
            redoLastChange();
        });
        $('#isbd-panel-undoall').on('click', () => {
            if (!internFeatureAllowed(state, 'panelApplyActions')) {
                toast('warning', 'Cataloging Assistant apply actions are disabled for this internship profile.');
                return;
            }
            undoAllChanges();
        });
        $('#isbd-panel-ignoreall').on('click', () => {
            ignoreAllFindings(state);
            updateSidePanel(state);
            toast('info', 'All suggestions ignored for this session.');
        });
        recoverFloatingPanel($('.isbd-panel'), { minWidth: 280, minHeight: 180, right: 20, bottom: 24, buttonSelector: '#isbd-panel-minimize' });
        updatePanelToggleButton();
    }

    function makePanelDraggable() {
        const $panel = $('.isbd-panel');
        if (!$panel.length || $panel.data('draggable')) return;
        $panel.data('draggable', true);
        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;
        $panel.find('header').on('mousedown', function(event) {
            if ($(event.target).closest('button').length) return;
            dragging = true;
            const rect = $panel[0].getBoundingClientRect();
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
            $panel.css({ right: 'auto' });
            $panel.addClass('dragging');
            event.preventDefault();
        });
        $(document).on('mousemove.isbdpanel', function(event) {
            if (!dragging) return;
            const left = Math.max(0, event.clientX - offsetX);
            const top = Math.max(0, event.clientY - offsetY);
            $panel.css({ left: `${left}px`, top: `${top}px` });
        });
        $(document).on('mouseup.isbdpanel', function() {
            dragging = false;
            $panel.removeClass('dragging');
            saveFloatingPanelState($panel);
        });
    }

    function attachTopResizeHandle($panel, options) {
        if (!$panel || !$panel.length) return;
        const opts = options || {};
        const minHeight = Number.isFinite(opts.minHeight) ? opts.minHeight : 180;
        const namespace = (opts.namespace || `isbdTopResize${$panel.attr('id') || $panel.attr('class') || 'panel'}`)
            .toString()
            .replace(/[^a-zA-Z0-9_-]/g, '');
        if ($panel.data(`topResizeBound:${namespace}`)) return;
        $panel.data(`topResizeBound:${namespace}`, 1);

        if (!$panel.children('.isbd-top-resize-handle').length) {
            $panel.prepend('<div class="isbd-top-resize-handle" aria-hidden="true"></div>');
        }
        const $handle = $panel.children('.isbd-top-resize-handle').first();
        let resizing = false;
        let startY = 0;
        let startTop = 0;
        let startHeight = 0;

        $handle.on('mousedown', function(event) {
            if ($panel.hasClass('minimized')) return;
            resizing = true;
            const rect = $panel[0].getBoundingClientRect();
            startY = event.clientY;
            startTop = rect.top;
            startHeight = rect.height;
            $panel.css({
                right: 'auto',
                bottom: 'auto',
                left: `${rect.left}px`,
                top: `${rect.top}px`
            });
            $panel.addClass('resizing');
            event.preventDefault();
            event.stopPropagation();
        });

        $(document).on(`mousemove.${namespace}`, function(event) {
            if (!resizing) return;
            const viewportHeight = Math.max(window.innerHeight || 0, 240);
            const delta = event.clientY - startY;
            let nextTop = startTop + delta;
            let nextHeight = startHeight - delta;

            if (nextTop < 0) {
                nextHeight += nextTop;
                nextTop = 0;
            }
            if (nextHeight < minHeight) {
                const deficit = minHeight - nextHeight;
                nextHeight = minHeight;
                nextTop = Math.max(0, nextTop - deficit);
            }
            const maxHeight = Math.max(minHeight, viewportHeight - nextTop);
            if (nextHeight > maxHeight) {
                nextHeight = maxHeight;
            }

            $panel.css({
                top: `${Math.round(nextTop)}px`,
                height: `${Math.round(nextHeight)}px`
            });
        });

        $(document).on(`mouseup.${namespace}`, function() {
            if (!resizing) return;
            resizing = false;
            $panel.removeClass('resizing');
            saveFloatingPanelState($panel);
        });
    }

    function updatePanelToggleButton() {
        const $toggle = $('#isbd-panel-toggle');
        if (!$toggle.length) return;
        if ($toggle.hasClass('isbd-disabled') || $toggle.attr('aria-disabled') === 'true') {
            $toggle.removeClass('is-on');
            return;
        }
        const isVisible = $('.isbd-panel:visible').length > 0;
        $toggle.toggleClass('is-on', !!isVisible);
    }

    function updateAiToggleButton() {
        const $toggle = $('#isbd-ai-toggle');
        if (!$toggle.length) return;
        if ($toggle.hasClass('isbd-disabled') || $toggle.attr('aria-disabled') === 'true') {
            $toggle.removeClass('is-on');
            return;
        }
        const isVisible = $('#isbd-ai-panel:visible').length > 0;
        $toggle.toggleClass('is-on', !!isVisible);
    }

    function updateGuideToggleButton() {
        const $toggle = $('#isbd-guide');
        if (!$toggle.length) return;
        const isVisible = $('.isbd-guide-modal:visible').length > 0;
        $toggle.toggleClass('is-on', !!isVisible);
    }

    function updateAboutToggleButton() {
        const $toggle = $('#isbd-about');
        if (!$toggle.length) return;
        const isVisible = $('.isbd-about-dialog:visible').length > 0;
        $toggle.toggleClass('is-on', !!isVisible);
    }

    function setFloatingMinimized($panel, minimized, buttonSelector, options) {
        if (!$panel || !$panel.length) return;
        const opts = options || {};
        const sizeKey = 'isbdPrevSize';
        if (minimized) {
            if (!$panel.data(sizeKey)) {
                $panel.data(sizeKey, {
                    height: $panel[0].style.height || '',
                    width: $panel[0].style.width || ''
                });
            }
            const headerHeight = Math.max($panel.find('header').outerHeight() || 0, 36);
            $panel.css('height', `${headerHeight}px`);
        } else {
            const prev = $panel.data(sizeKey) || {};
            if (prev.height !== undefined) {
                $panel.css('height', prev.height);
            }
            if (prev.width !== undefined) {
                $panel.css('width', prev.width);
            }
            $panel.removeData(sizeKey);
        }
        $panel.toggleClass('minimized', minimized);
        if (buttonSelector) {
            const $button = $panel.find(buttonSelector);
            if ($button.length) {
                $button.text(minimized ? 'Maximize' : 'Minimize');
            }
        }
        if (!opts.skipSave) {
            saveFloatingPanelState($panel);
        }
    }

    function recoverFloatingPanel($panel, options) {
        if (!$panel || !$panel.length || !$panel[0]) return;
        const opts = options || {};
        const minWidth = opts.minWidth || 300;
        const minHeight = opts.minHeight || 200;
        const right = Number.isFinite(opts.right) ? opts.right : 24;
        const bottom = Number.isFinite(opts.bottom) ? opts.bottom : 24;
        const buttonSelector = opts.buttonSelector || '';
        loadFloatingPanelState($panel, buttonSelector);
        const viewportWidth = Math.max(window.innerWidth || 0, 320);
        const viewportHeight = Math.max(window.innerHeight || 0, 240);
        const isVisible = $panel.is(':visible');

        if (!$panel.hasClass('minimized')) {
            const currentHeight = $panel.outerHeight();
            if (isVisible && (!Number.isFinite(currentHeight) || currentHeight < 80)) {
                $panel.css('height', `${Math.min(Math.max(minHeight, 220), Math.max(220, viewportHeight - 20))}px`);
            }
        }
        const currentWidth = $panel.outerWidth();
        if (isVisible && (!Number.isFinite(currentWidth) || currentWidth < 180)) {
            $panel.css('width', `${Math.min(Math.max(minWidth, 320), Math.max(320, viewportWidth - 20))}px`);
        }
        if ($panel.hasClass('minimized') && (($panel.find('header').outerHeight() || 0) < 24)) {
            setFloatingMinimized($panel, 0, buttonSelector);
        }

        const rect = $panel[0].getBoundingClientRect();
        const offscreen =
            rect.bottom < 30
            || rect.top > (viewportHeight - 30)
            || rect.right < 30
            || rect.left > (viewportWidth - 30)
            || rect.width < 120
            || rect.height < 24;
        if (offscreen) {
            $panel.css({
                left: 'auto',
                top: 'auto',
                right: `${right}px`,
                bottom: `${bottom}px`
            });
            if ($panel.hasClass('minimized')) {
                setFloatingMinimized($panel, 0, buttonSelector);
            }
            return;
        }

        const nextLeft = Math.min(Math.max(0, rect.left), Math.max(0, viewportWidth - Math.max(rect.width, minWidth)));
        const nextTop = Math.min(Math.max(0, rect.top), Math.max(0, viewportHeight - Math.max(rect.height, 80)));
        if (Math.abs(nextLeft - rect.left) > 1 || Math.abs(nextTop - rect.top) > 1) {
            $panel.css({
                right: 'auto',
                bottom: 'auto',
                left: `${nextLeft}px`,
                top: `${nextTop}px`
            });
        }
    }

    function makeGuideDraggable() {
        const $modal = $('.isbd-guide-modal');
        if (!$modal.length || $modal.data('draggable')) return;
        $modal.data('draggable', true);
        attachTopResizeHandle($modal, { minHeight: 220, namespace: 'isbdguideTopResize' });
        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;
        $modal.find('header').on('mousedown', function(event) {
            if ($(event.target).closest('button').length) return;
            dragging = true;
            const rect = $modal[0].getBoundingClientRect();
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
            $modal.css({ right: 'auto', left: `${rect.left}px`, top: `${rect.top}px` });
            $modal.addClass('dragging');
            event.preventDefault();
        });
        $(document).on('mousemove.isbdguideDrag', function(event) {
            if (!dragging) return;
            const left = Math.max(0, event.clientX - offsetX);
            const top = Math.max(0, event.clientY - offsetY);
            $modal.css({ left: `${left}px`, top: `${top}px` });
        });
        $(document).on('mouseup.isbdguideDrag', function() {
            dragging = false;
            $modal.removeClass('dragging');
            saveFloatingPanelState($modal);
        });
    }

    function makeAiPanelDraggable() {
        const $panel = $('.isbd-ai-panel');
        if (!$panel.length || $panel.data('draggable')) return;
        $panel.data('draggable', true);
        attachTopResizeHandle($panel, { minHeight: 220, namespace: 'isbdaiTopResize' });
        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;
        $panel.find('header').on('mousedown', function(event) {
            if ($(event.target).closest('button').length) return;
            dragging = true;
            const rect = $panel[0].getBoundingClientRect();
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
            $panel.css({ right: 'auto', left: `${rect.left}px`, top: `${rect.top}px` });
            $panel.addClass('dragging');
            event.preventDefault();
        });
        $(document).on('mousemove.isbdaipanel', function(event) {
            if (!dragging) return;
            const left = Math.max(0, event.clientX - offsetX);
            const top = Math.max(0, event.clientY - offsetY);
            $panel.css({ left: `${left}px`, top: `${top}px` });
        });
        $(document).on('mouseup.isbdaipanel', function() {
            dragging = false;
            $panel.removeClass('dragging');
            saveFloatingPanelState($panel);
        });
    }

    function makeAboutDialogDraggable() {
        const $dialog = $('.isbd-about-dialog');
        if (!$dialog.length || $dialog.data('draggable')) return;
        $dialog.data('draggable', true);
        $(document).off('mousemove.isbdaboutDrag mouseup.isbdaboutDrag');
        attachTopResizeHandle($dialog, { minHeight: 220, namespace: 'isbdaboutTopResize' });
        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;
        $dialog.find('header').on('mousedown', function(event) {
            if ($(event.target).closest('button, a').length) return;
            dragging = true;
            const rect = $dialog[0].getBoundingClientRect();
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
            $dialog.css({
                transform: 'none',
                right: 'auto',
                left: `${rect.left}px`,
                top: `${rect.top}px`
            });
            $dialog.addClass('dragging');
            event.preventDefault();
        });
        $(document).on('mousemove.isbdaboutDrag', function(event) {
            if (!dragging) return;
            const left = Math.max(0, event.clientX - offsetX);
            const top = Math.max(0, event.clientY - offsetY);
            $dialog.css({ left: `${left}px`, top: `${top}px` });
        });
        $(document).on('mouseup.isbdaboutDrag', function() {
            dragging = false;
            $dialog.removeClass('dragging');
            saveFloatingPanelState($dialog);
        });
    }

    function setGuideMinimized($modal, minimized) {
        if (!$modal || !$modal.length) return;
        $modal.toggleClass('minimized', minimized);
        const $button = $modal.find('#isbd-guide-minimize');
        if ($button.length) {
            $button.text(minimized ? 'Maximize' : 'Minimize');
        }
        saveFloatingPanelState($modal);
    }

    function bindFieldHandlers(settings, state) {
        const selector = 'input[id*="subfield"], input[id*="tag_"], textarea[id*="subfield"], textarea[id*="tag_"], select[id*="subfield"], select[id*="tag_"], input[name^="field_"], textarea[name^="field_"], select[name^="field_"]';
        $(document).on('focusin.isbd', selector, function() {
            if (parseFieldMeta(this)) {
                state.lastFocusedField = this;
            }
            const $aiPanel = $('#isbd-ai-panel');
            if ($aiPanel.length && $aiPanel.is(':visible')) {
                updateAiPanelSelection($aiPanel, settings, state);
                updateAiCatalogingContext($aiPanel, settings, state);
            }
        });
        $(document).on('blur.isbd', selector, function() {
            const meta = parseFieldMeta(this);
            const indicatorMeta = !meta ? parseIndicatorMeta(this) : null;
            if (meta) {
                runFieldValidation(this, settings, state, { apply: true });
            } else if (indicatorMeta) {
                runIndicatorValidation(indicatorMeta, settings, state, { apply: true });
            }
        });
        $(document).on('change.isbd', selector, function() {
            if (document.activeElement === this) return;
            const meta = parseFieldMeta(this);
            const indicatorMeta = !meta ? parseIndicatorMeta(this) : null;
            if (meta) {
                runFieldValidation(this, settings, state, { apply: true });
            } else if (indicatorMeta) {
                runIndicatorValidation(indicatorMeta, settings, state, { apply: true });
            }
        });

        $(document).on('input.isbd', selector, function() {
            $(this).siblings('.isbd-ghost-text').remove();
            const meta = parseFieldMeta(this);
            const indicatorMeta = !meta ? parseIndicatorMeta(this) : null;
            if (settings.enableLiveValidation) {
                if (meta) {
                    runFieldValidation(this, settings, state, { apply: false });
                    consumeRevalidation(state, meta);
                } else if (indicatorMeta) {
                    runIndicatorValidation(indicatorMeta, settings, state, { apply: false });
                }
            } else if (consumeRevalidation(state, meta)) {
                runFieldValidation(this, settings, state, { apply: false });
            }
            const $aiPanel = $('#isbd-ai-panel');
            if ($aiPanel.length && $aiPanel.is(':visible')) {
                updateAiPanelSelection($aiPanel, settings, state);
                updateAiCatalogingContext($aiPanel, settings, state);
            }
        });

        $(document).on('keydown.isbd', selector, function(event) {
            if (event.key !== 'Tab' && event.key !== 'Enter') return;
            const $ghost = $(this).siblings('.isbd-ghost-text');
            if (!$ghost.length) return;
            const expected = $ghost.data('expected');
            if (!expected) return;
            event.preventDefault();
            $(this).val(expected);
            $ghost.remove();
            markFieldForRevalidation(state, parseFieldMeta(this));
            toast('info', 'ISBD ghost suggestion applied.');
        });
    }

    function bindPanelInteractionGuards() {
        // Prevent active MARC field blur from swallowing the first panel-button click.
        $(document).off('mousedown.isbdpanelactions');
        $(document).on('mousedown.isbdpanelactions',
            '.isbd-panel button, .isbd-ai-panel button, .isbd-guide-modal button',
            function(event) {
                event.preventDefault();
            });
    }

    function runFieldValidation(element, settings, state, options) {
        if (!settings.enabled && !(settings.enforceIsbdGuardrails || settings.enableLiveValidation)) return;
        const opts = options || {};
        const meta = parseFieldMeta(element);
        if (!meta) return;
        const lockKey = buildFieldKey(meta);
        if (state && state.validationLocks && state.validationLocks.has(lockKey)) return;
        if (state && state.validationLocks) {
            state.validationLocks.add(lockKey);
        }
        const visited = opts.visited || new Set();
        visited.add(lockKey);
        try {
            if (state && opts.recordChange !== false) {
                state.lastChangeMeta = { ...meta };
                state.lastChangeAt = Date.now();
            }
            if (isTagExcluded(settings, state, meta.tag)) return;
            const fieldContext = buildFieldContext(meta.tag, meta.occurrence);
            if (!fieldContext) return;
            const result = global.ISBDRulesEngine.validateField(fieldContext, settings, state.rules);
            const filteredFindings = result.findings.filter(finding => !isExcluded(settings, state, finding.tag, finding.subfield));
            updateFindingsForField(state, meta, filteredFindings);
            if (opts.apply) {
                applyAutoFixes(settings, state, meta, filteredFindings);
            }
            const statementCaseContext = opts.apply ? buildFieldContext(meta.tag, meta.occurrence) : fieldContext;
            queueStatementCaseValidation(statementCaseContext || fieldContext, settings, state);
            queueMainEntryPersonalNameValidation(statementCaseContext || fieldContext, settings, state);
            const combinedFindings = collectFindingsForField(state, meta.tag, meta.occurrence);
            updateIndicators(fieldContext, combinedFindings);
            updateSidePanel(state);
            updateGuardrails(settings, state);
            if (opts.apply) {
                notifyDependentFindings(meta, filteredFindings, state);
            }
            maybeShowGhost(element, filteredFindings, settings, state);
            refreshGuideForChange(state, meta);
            if (!opts.skipDependents) {
                revalidateDependentSubfields(settings, state, meta, {
                    apply: opts.apply,
                    visited,
                    recordChange: false
                });
            }
        } finally {
            if (state && state.validationLocks) {
                state.validationLocks.delete(lockKey);
            }
        }
    }

    function runIndicatorValidation(indicatorMeta, settings, state, options) {
        if (!settings.enabled && !(settings.enforceIsbdGuardrails || settings.enableLiveValidation)) return;
        if (!indicatorMeta) return;
        if (isTagExcluded(settings, state, indicatorMeta.tag)) return;
        const fieldContext = buildFieldContext(indicatorMeta.tag, indicatorMeta.occurrence);
        if (!fieldContext) return;
        const result = global.ISBDRulesEngine.validateField(fieldContext, settings, state.rules);
        const filteredFindings = result.findings.filter(finding => !isExcluded(settings, state, finding.tag, finding.subfield));
        updateFindingsForField(state, { tag: indicatorMeta.tag, code: '*', occurrence: indicatorMeta.occurrence || '' }, filteredFindings);
        if (options && options.apply) {
            applyAutoFixes(settings, state, { tag: indicatorMeta.tag, code: '*', occurrence: indicatorMeta.occurrence || '' }, filteredFindings);
        }
        const statementCaseContext = (options && options.apply)
            ? buildFieldContext(indicatorMeta.tag, indicatorMeta.occurrence)
            : fieldContext;
        queueStatementCaseValidation(statementCaseContext || fieldContext, settings, state);
        queueMainEntryPersonalNameValidation(statementCaseContext || fieldContext, settings, state);
        const combinedFindings = collectFindingsForField(state, indicatorMeta.tag, indicatorMeta.occurrence || '');
        updateIndicators(fieldContext, combinedFindings);
        updateSidePanel(state);
        updateGuardrails(settings, state);
        refreshGuideForChange(state, { tag: indicatorMeta.tag, code: '', occurrence: indicatorMeta.occurrence || '' });
    }

    function bindFormHandlers(settings, state) {
        $('form[name="f"], #cat_addbiblio form').on('submit.isbd', function(event) {
            const record = filterRecordContext(buildRecordContext(), settings, state);
            const result = global.ISBDRulesEngine.validateRecord(record, settings, state.rules, settings.strictCoverageMode);
            state.findings = groupFindings(result.findings);
            if (settings.enabled && state.autoApply && result.findings.length) {
                result.findings.forEach(finding => {
                    const patch = finding.proposed_fixes && finding.proposed_fixes[0] && finding.proposed_fixes[0].patch[0];
                    if (patch) applyPatch(patch, finding.occurrence, finding);
                });
                refreshAll(settings);
            }
            updateSidePanel(state);
            updateGuardrails(settings, state);
            const errorCount = countSeverity(state.findings, 'ERROR');
            const missingRequiredCount = Array.isArray(state.missingRequired) ? state.missingRequired.length : 0;
            const blockingCount = errorCount + missingRequiredCount;
            if (settings.blockSaveOnError && settings.enforceIsbdGuardrails && blockingCount > 0) {
                event.preventDefault();
                const parts = [];
                if (errorCount) parts.push(`${errorCount} ISBD error(s)`);
                if (missingRequiredCount) parts.push(`${missingRequiredCount} required field(s) missing`);
                toast('error', `Save blocked: ${parts.join(' and ')} detected.`);
            }
        });
    }

    function attachCopyCatalogObserver(settings, state) {
        if (state.copyObserver || !global.MutationObserver) return;
        const form = document.querySelector('form[name="f"], #cat_addbiblio form');

        if (!form) return;
        let refreshTimer = null;
        const observer = new MutationObserver(() => {
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => refreshAll(settings), 300);
        });
        observer.observe(form, { childList: true, subtree: true });
        state.copyObserver = observer;
    }

    function parseFieldMeta(element) {
        const id = element.id || '';
        const name = element.name || '';
        let match = id.match(/tag_(\d{3})_subfield_(00|[a-z0-9])(?:_(\d+(?:_\d+)*))?/i);
        if (!match) match = id.match(/subfield(\d{3})(00|[a-z0-9])/i);
        if (!match && name) match = name.match(/tag_(\d{3})_subfield_(00|[a-z0-9])(?:_(\d+(?:_\d+)*))?/i);
        if (!match && name) match = name.match(/field_(\d{3})(00|[a-z0-9])(?:_(\d+(?:_\d+)*))?/i);
        if (!match) return null;
        return { tag: match[1], code: normalizeSubfieldCode(match[2]), occurrence: match[3] || '' };
    }

    function buildFieldKey(meta) {
        if (!meta) return '';
        return `${meta.tag}$${meta.code}:${normalizeOccurrenceKey(meta.occurrence)}`;
    }

    function normalizeOccurrence(value) {
        if (value === undefined || value === null || value === '') return 0;
        const parsed = Number.parseInt(value, 10);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    function normalizeOccurrenceKey(value) {
        return String(normalizeOccurrence(value));
    }

    function markFieldForRevalidation(state, meta) {
        if (!state || !state.revalidateAfterApply || !meta) return;
        state.revalidateAfterApply.add(buildFieldKey(meta));
    }

    function consumeRevalidation(state, meta) {
        if (!state || !state.revalidateAfterApply || !meta) return false;
        const key = buildFieldKey(meta);
        if (!state.revalidateAfterApply.has(key)) return false;
        state.revalidateAfterApply.delete(key);
        return true;
    }

    function normalizeTag(tag) {
        const text = (tag || '').toString().trim();
        if (/^\d{1,3}$/.test(text)) return text.padStart(3, '0');
        return text;
    }

    function isValidTag(tag) {
        return /^\d{3}$/.test(normalizeTag(tag));
    }

    function normalizeSubfieldCode(code) {
        const text = (code || '').toString().trim().toLowerCase();
        if (text === '00' || text === '0') return '0';
        return text;
    }

    function subfieldCodeVariants(code) {
        const normalized = normalizeSubfieldCode(code);
        if (!normalized) return [];
        if (normalized === '0') return ['0', '00'];
        return [normalized];
    }

    function isValidSubfieldCode(code) {
        const normalized = normalizeSubfieldCode(code);
        return /^[a-z0-9]$/i.test(normalized || '');
    }

    function isGuideSubfieldCode(code) {
        return /^[a-z]$/i.test(code || '');
    }

    function parseIndicatorMeta(element) {
        const id = element.id || '';
        const name = element.name || '';
        let match = id.match(/tag_(\d{3})_indicator([12])(?:_(\d+(?:_\d+)*))?/i);
        if (!match && name) match = name.match(/tag_(\d{3})_indicator([12])(?:_(\d+(?:_\d+)*))?/i);
        if (!match) return null;
        return { tag: match[1], indicator: match[2], occurrence: match[3] || '' };
    }

    function buildRuleDependencies(rules) {
        const dependencyMap = new Map();
        const addDependency = (tag, fromCode, toCode) => {
            if (!tag || !fromCode || !toCode) return;
            if (!dependencyMap.has(tag)) dependencyMap.set(tag, new Map());
            const byTag = dependencyMap.get(tag);
            if (!byTag.has(fromCode)) byTag.set(fromCode, new Set());
            byTag.get(fromCode).add(toCode);
        };
        (rules || []).forEach(rule => {
            if (!rule || !rule.tag) return;
            const tag = rule.tag;
            const targetCodes = Array.isArray(rule.subfields)
                ? rule.subfields.map(code => (code || '').toLowerCase())
                : [];
            const hasPattern = !targetCodes.length && rule.subfield_pattern;
            const dependencies = new Set();
            if (Array.isArray(rule.requires_subfields)) rule.requires_subfields.forEach(code => dependencies.add((code || '').toLowerCase()));
            if (Array.isArray(rule.forbids_subfields)) rule.forbids_subfields.forEach(code => dependencies.add((code || '').toLowerCase()));
            if (Array.isArray(rule.requires_following_subfields)) rule.requires_following_subfields.forEach(code => dependencies.add((code || '').toLowerCase()));
            if (Array.isArray(rule.forbids_following_subfields)) rule.forbids_following_subfields.forEach(code => dependencies.add((code || '').toLowerCase()));
            if (Array.isArray(rule.requires_preceding_subfields)) rule.requires_preceding_subfields.forEach(code => dependencies.add((code || '').toLowerCase()));
            if (Array.isArray(rule.forbids_preceding_subfields)) rule.forbids_preceding_subfields.forEach(code => dependencies.add((code || '').toLowerCase()));
            if (rule.next_subfield_is) {
                [].concat(rule.next_subfield_is).forEach(code => dependencies.add((code || '').toLowerCase()));
            }
            if (rule.previous_subfield_is) {
                [].concat(rule.previous_subfield_is).forEach(code => dependencies.add((code || '').toLowerCase()));
            }
            (rule.checks || []).forEach(check => {
                if (Array.isArray(check.when_following_subfields)) {
                    check.when_following_subfields.forEach(code => dependencies.add((code || '').toLowerCase()));
                }
                if (Array.isArray(check.when_preceding_subfields)) {
                    check.when_preceding_subfields.forEach(code => dependencies.add((code || '').toLowerCase()));
                }
            });
            if (!targetCodes.length && hasPattern) {
                addDependency(tag, '*', '*');
                dependencies.forEach(code => addDependency(tag, code, '*'));
                return;
            }
            if (!targetCodes.length) return;
            targetCodes.forEach(target => {
                addDependency(tag, target, target);
                dependencies.forEach(code => addDependency(tag, code, target));
            });
        });
        return dependencyMap;
    }

    function getDependentSubfields(state, tag, code) {
        if (!state || !state.ruleDependencies || !tag) return null;
        const byTag = state.ruleDependencies.get(tag);
        if (!byTag) return null;
        const deps = new Set();
        const direct = byTag.get(code);
        if (direct) direct.forEach(item => deps.add(item));
        const wildcard = byTag.get('*');
        if (wildcard) wildcard.forEach(item => deps.add(item));
        return deps.size ? deps : null;
    }

    function revalidateDependentSubfields(settings, state, meta, options) {
        if (!meta || !meta.tag || !meta.code) return;
        const deps = getDependentSubfields(state, meta.tag, (meta.code || '').toLowerCase());
        if (!deps || !deps.size) return;
        const opts = options || {};
        const visited = opts.visited || new Set();
        const occurrence = meta.occurrence || '';
        deps.forEach(code => {
            if (!code || code === '*' || code === (meta.code || '').toLowerCase()) return;
            const $field = findFieldElement(meta.tag, code, occurrence);
            if (!$field.length) return;
            const fieldMeta = parseFieldMeta($field[0]);
            if (!fieldMeta) return;
            const fieldKey = buildFieldKey(fieldMeta);
            if (visited.has(fieldKey)) return;
            visited.add(fieldKey);
            runFieldValidation($field[0], settings, state, {
                apply: opts.apply,
                skipDependents: false,
                visited,
                recordChange: opts.recordChange
            });
        });
    }

    function refreshGuideForChange(state, meta) {
        if (!state || !state.guideActive || !state.guideRefresh || !state.guideCurrentStep) return;
        const step = state.guideCurrentStep;
        if (!step || !step.tag) return;
        const tag = meta && meta.tag ? meta.tag : '';
        if (tag && tag !== step.tag && !(step.alternateTags || []).includes(tag)) return;
        const changedCode = meta && meta.code ? meta.code.toLowerCase() : '';
        const stepCode = (step.code || '').toLowerCase();
        if (!stepCode || !changedCode) {
            state.guideRefresh();
            return;
        }
        if (stepCode === changedCode) {
            state.guideRefresh();
            return;
        }
        const affected = getDependentSubfields(state, step.tag, changedCode);
        if (!affected) {
            state.guideRefresh();
            return;
        }
        if (affected.has(stepCode) || affected.has('*')) {
            state.guideRefresh();
        }
    }

    function findIndicatorValue(tag, indicator, occurrence) {
        const selector = [
            `input[id^="tag_${tag}_indicator${indicator}"]`,
            `select[id^="tag_${tag}_indicator${indicator}"]`,
            `input[name^="tag_${tag}_indicator${indicator}"]`,
            `select[name^="tag_${tag}_indicator${indicator}"]`
        ].join(',');
        let value = '';
        $(selector).each(function() {
            const meta = parseIndicatorMeta(this);
            if (!meta || meta.tag !== tag) return;
            if (!isSameOccurrence(meta.occurrence, occurrence)) return;
            value = $(this).val() || '';
            return false;
        });
        return value;
    }

    function buildFieldContext(tag, occurrence) {
        const field = { tag, ind1: '', ind2: '', occurrence: normalizeOccurrenceKey(occurrence), subfields: [] };
        field.ind1 = findIndicatorValue(tag, 1, occurrence) || '';
        field.ind2 = findIndicatorValue(tag, 2, occurrence) || '';
        const selector = `input[id^="tag_${tag}_subfield_"], textarea[id^="tag_${tag}_subfield_"], select[id^="tag_${tag}_subfield_"], input[id^="subfield${tag}"], textarea[id^="subfield${tag}"], select[id^="subfield${tag}"], input[name^="field_${tag}"], textarea[name^="field_${tag}"], select[name^="field_${tag}"]`;
        $(selector).each(function() {
            const meta = parseFieldMeta(this);
            if (!meta || meta.tag !== tag) return;
            if (!isSameOccurrence(meta.occurrence, occurrence)) return;
            const value = $(this).val() || '';
            const provenance = global.ISBDIntellisenseState
                && global.ISBDIntellisenseState.punctuationProvenance
                ? global.ISBDIntellisenseState.punctuationProvenance.get(this)
                : null;
            const subfield = { code: meta.code, value };
            if (provenance && provenance.value === value) {
                subfield.punctuation_provenance = { ...provenance };
            }
            field.subfields.push(subfield);
        });
        if (!field.subfields.length) return null;
        return field;
    }

    function buildRecordContext() {
        const fields = {};
        const selector = 'input[id*="subfield"], input[id*="tag_"], textarea[id*="subfield"], textarea[id*="tag_"], select[id*="subfield"], select[id*="tag_"], input[name^="field_"], textarea[name^="field_"], select[name^="field_"]';
        $(selector).each(function() {
            const meta = parseFieldMeta(this);
            if (!meta) return;
            const key = `${meta.tag}:${normalizeOccurrenceKey(meta.occurrence)}`;
            if (!fields[key]) {
                fields[key] = { tag: meta.tag, ind1: '', ind2: '', occurrence: normalizeOccurrenceKey(meta.occurrence), subfields: [] };
            }
            const value = $(this).val() || '';
            const provenance = global.ISBDIntellisenseState
                && global.ISBDIntellisenseState.punctuationProvenance
                ? global.ISBDIntellisenseState.punctuationProvenance.get(this)
                : null;
            const subfield = { code: meta.code, value };
            if (provenance && provenance.value === value) {
                subfield.punctuation_provenance = { ...provenance };
            }
            fields[key].subfields.push(subfield);
        });
        Object.values(fields).forEach(field => {
            field.ind1 = findIndicatorValue(field.tag, 1, field.occurrence) || '';
            field.ind2 = findIndicatorValue(field.tag, 2, field.occurrence) || '';
        });
        return { fields: Object.values(fields) };
    }

    function filterRecordContext(record, settings, state) {
        const filtered = record.fields.map(field => {
            const subfields = field.subfields.filter(sub => !isExcluded(settings, state, field.tag, sub.code));
            return { ...field, subfields };
        }).filter(field => field.subfields.length);
        return { fields: filtered };
    }

    function buildAiRecordContext(meta, settings, state) {
        const mode = settings.aiContextMode || 'tag_only';
        if (mode === 'tag_only') return null;
        const record = filterRecordContext(buildRecordContext(), settings, state);
        const normalized = {
            fields: (record.fields || []).map(field => {
                return { ...field, occurrence: normalizeOccurrence(field.occurrence) };
            })
        };
        if (mode === 'full' || mode === 'full_record') return normalized;
        // The server selects related fields by MARC semantics. DOM adjacency
        // is not a bibliographic relationship, so send normalized candidates.
        if (mode === 'tag_plus_neighbors' || mode === 'tag_plus_related_fields') return normalized;
        return normalized;
    }

    function shouldRedactValue(settings, state, tag, code, value) {
        if (settings.aiRedact856Querystrings && tag === '856' && (code || '').toLowerCase() === 'u') {
            if (value && /[?&]/.test(value)) return true;
        }
        const rules = (state && state.redactionRules) ? state.redactionRules : [];
        return rules.some(entry => {
            if (/^9XX$/i.test(entry)) return /^9\d\d$/.test(tag);
            if (/^\dXX$/i.test(entry)) return new RegExp(`^${entry[0]}\\d\\d$`).test(tag);
            if (/^\d{3}[a-z0-9]$/i.test(entry)) return entry.toLowerCase() === `${tag}${code}`.toLowerCase();
            if (/^\d{3}$/i.test(entry)) return entry === tag;
            return false;
        });
    }

    function redactTagContext(tagContext, settings, state) {
        if (!tagContext || typeof tagContext !== 'object') return {};
        const clone = { ...tagContext };
        if (Array.isArray(clone.subfields)) {
            clone.subfields = clone.subfields.map(sub => {
                const value = shouldRedactValue(settings, state, clone.tag, sub.code, sub.value)
                    ? '[REDACTED]'
                    : (sub.value || '');
                const output = { code: sub.code, value };
                if (value === sub.value && sub.punctuation_provenance
                    && sub.punctuation_provenance.value === sub.value) {
                    output.punctuation_provenance = { ...sub.punctuation_provenance };
                }
                return output;
            });
        }
        return clone;
    }

    function redactRecordContext(recordContext, settings, state) {
        if (!recordContext || typeof recordContext !== 'object') return {};
        const fields = Array.isArray(recordContext.fields) ? recordContext.fields : [];
        return {
            fields: fields.map(field => {
                const subfields = Array.isArray(field.subfields) ? field.subfields : [];
                return {
                    ...field,
                    subfields: subfields.map(sub => {
                        const value = shouldRedactValue(settings, state, field.tag, sub.code, sub.value)
                            ? '[REDACTED]'
                            : (sub.value || '');
                        return { code: sub.code, value };
                    })
                };
            })
        };
    }

    function isExcluded(settings, state, tag, code) {
        if (!settings.enableLocalFields && /^9\d\d$/.test(tag)) return true;
        if (settings.enableLocalFields && state.localAllowlist.length) {
            const allowed = state.localAllowlist.some(entry => {
                if (/^9XX$/i.test(entry)) return /^9\d\d$/.test(tag);
                if (/^\dXX$/i.test(entry)) return new RegExp(`^${entry[0]}\\d\\d$`).test(tag);
                if (/^\d{3}[a-z0-9]$/i.test(entry)) return entry.toLowerCase() === `${tag}${code}`.toLowerCase();
                if (/^\d{3}$/i.test(entry)) return entry === tag;
                return false;
            });
            if (!allowed) return true;
        }
        return state.excludedTags.some(entry => {
            if (/^\dXX$/i.test(entry)) return new RegExp(`^${entry[0]}\\d\\d$`).test(tag);
            if (/^\d{3}[a-z0-9]$/i.test(entry)) return entry.toLowerCase() === `${tag}${code}`.toLowerCase();
            if (/^\d{3}$/i.test(entry)) return entry === tag;
            if (/^9XX$/i.test(entry)) return /^9\d\d$/.test(tag);
            return false;
        });
    }

    function isTagExcluded(settings, state, tag) {
        if (!settings.enableLocalFields && /^9\d\d$/.test(tag)) return true;
        if (settings.enableLocalFields && state.localAllowlist.length) {
            const allowed = state.localAllowlist.some(entry => {
                if (/^9XX$/i.test(entry)) return /^9\d\d$/.test(tag);
                if (/^\dXX$/i.test(entry)) return new RegExp(`^${entry[0]}\\d\\d$`).test(tag);
                if (/^\d{3}$/i.test(entry)) return entry === tag;
                return false;
            });
            if (!allowed) return true;
        }
        return state.excludedTags.some(entry => {
            if (/^\dXX$/i.test(entry)) return new RegExp(`^${entry[0]}\\d\\d$`).test(tag);
            if (/^\d{3}$/i.test(entry)) return entry === tag;
            if (/^9XX$/i.test(entry)) return /^9\d\d$/.test(tag);
            return false;
        });
    }

    function updateFindingsForField(state, meta, findings) {
        const occurrenceKey = normalizeOccurrenceKey(meta.occurrence);
        Array.from(state.findings.keys()).forEach(key => {
            if (key.startsWith(meta.tag) && key.endsWith(`:${occurrenceKey}`)) {
                state.findings.delete(key);
            }
        });
        const grouped = groupFindings(findings);
        grouped.forEach((list, key) => {
            state.findings.set(key, dedupeFindings(list));
        });
    }

    function groupFindings(findings) {
        const grouped = new Map();
        dedupeFindings(findings).forEach(finding => {
            const key = `${finding.tag}${finding.subfield}:${normalizeOccurrenceKey(finding.occurrence)}`;
            const existing = grouped.get(key) || [];
            existing.push(finding);
            grouped.set(key, existing);
        });
        return grouped;
    }

    function buildFindingKey(finding) {
        return [
            finding.severity,
            finding.code,
            finding.tag,
            finding.subfield,
            normalizeOccurrenceKey(finding.occurrence),
            finding.expected_value || '',
            finding.message || ''
        ].join('|');
    }

    function isFindingIgnored(state, finding) {
        if (!state || !state.ignoredFindings) return false;
        return state.ignoredFindings.has(buildFindingKey(finding));
    }

    function ignoreFinding(state, finding) {
        if (!state || !state.ignoredFindings) return;
        state.ignoredFindings.add(buildFindingKey(finding));
    }

    function ignoreAllFindings(state) {
        if (!state || !state.ignoredFindings) return;
        state.findings.forEach(list => {
            list.forEach(finding => {
                state.ignoredFindings.add(buildFindingKey(finding));
            });
        });
    }

    function dedupeFindings(findings) {
        const seen = new Set();
        const result = [];
        findings.forEach(finding => {
            const key = buildFindingKey(finding);
            if (seen.has(key)) return;
            seen.add(key);
            result.push(finding);
        });
        return result;
    }

    const STATEMENT_CASE_FINDING_CODE = 'ISBD_STATEMENT_245C_CASE';
    const MAIN_ENTRY_NAME_COMMA_CODE = 'ISBD_100A_NAME_COMMA';
    const MAIN_ENTRY_NAME_COMMA_SPACING_CODE = 'ISBD_100A_COMMA_SPACING';
    const MAIN_ENTRY_NAME_TERMINAL_PERIOD_CODE = 'ISBD_100A_NO_TERMINAL_PERIOD';

    function isStatementCaseEnabled(settings) {
        return !!(settings && settings.enabled);
    }

    function isMainEntryNameGuardrailEnabled(settings) {
        return !!(settings && settings.enabled);
    }

    function normalizeMainEntryNameValue(value) {
        return (value || '')
            .toString()
            .replace(/\s*,\s*/g, ', ')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    function looksLikeInitialToken(token) {
        return /^[A-Za-z]\.$/.test((token || '').toString());
    }

    function looksLikeMultiNameWithoutComma(value) {
        const text = (value || '').toString().trim();
        if (!text || text.includes(',')) return false;
        const tokens = text.split(/\s+/).filter(Boolean);
        if (tokens.length < 2) return false;
        const nameLike = tokens.filter(token => /^[A-Za-z][A-Za-z'.-]*$/.test(token) || looksLikeInitialToken(token));
        return nameLike.length >= 2;
    }

    function endsWithInitialPeriod(value) {
        const text = (value || '').toString().trim();
        if (!text) return false;
        if (/(?:^|[\s,])[A-Za-z]\.$/.test(text)) return true;
        return /(?:[A-Za-z]\.\s*){2,}$/.test(text);
    }

    function buildMainEntryNameCommaFinding(meta, current) {
        return {
            severity: 'ERROR',
            code: MAIN_ENTRY_NAME_COMMA_CODE,
            message: '100$a personal name must use inverted form with comma-space (Surname, Forename/initials).',
            rationale: 'Main entry personal names should separate surname and given names with ", ".',
            tag: meta.tag,
            subfield: meta.code,
            occurrence: normalizeOccurrenceKey(meta.occurrence),
            current_value: current,
            expected_value: '',
            proposed_fixes: []
        };
    }

    function buildMainEntryNameCommaSpacingFinding(meta, current, expected) {
        return {
            severity: 'WARNING',
            code: MAIN_ENTRY_NAME_COMMA_SPACING_CODE,
            message: 'Normalize comma spacing in 100$a to comma followed by one space.',
            rationale: 'Use ", " between surname and following name elements.',
            tag: meta.tag,
            subfield: meta.code,
            occurrence: normalizeOccurrenceKey(meta.occurrence),
            current_value: current,
            expected_value: expected,
            proposed_fixes: [{
                label: 'Normalize comma spacing',
                patch: [{
                    op: 'replace_subfield',
                    tag: meta.tag,
                    code: meta.code,
                    value: expected
                }]
            }]
        };
    }

    function buildMainEntryNameTerminalPeriodFinding(meta, current, expected) {
        return {
            severity: 'WARNING',
            code: MAIN_ENTRY_NAME_TERMINAL_PERIOD_CODE,
            message: 'Main entry headings generally should not end with terminal punctuation.',
            rationale: 'Remove a trailing terminal period unless it is part of an initial.',
            tag: meta.tag,
            subfield: meta.code,
            occurrence: normalizeOccurrenceKey(meta.occurrence),
            current_value: current,
            expected_value: expected,
            proposed_fixes: [{
                label: 'Remove terminal period',
                patch: [{
                    op: 'replace_subfield',
                    tag: meta.tag,
                    code: meta.code,
                    value: expected
                }]
            }]
        };
    }

    function updateMainEntryNameFindings(state, meta, findings) {
        if (!state || !meta) return;
        const key = `${meta.tag}${meta.code}:${normalizeOccurrenceKey(meta.occurrence)}`;
        const current = state.findings.get(key) || [];
        const filtered = current.filter(item => ![
            MAIN_ENTRY_NAME_COMMA_CODE,
            MAIN_ENTRY_NAME_COMMA_SPACING_CODE,
            MAIN_ENTRY_NAME_TERMINAL_PERIOD_CODE
        ].includes(item.code));
        (findings || []).forEach(item => {
            if (item) filtered.push(item);
        });
        state.findings.set(key, dedupeFindings(filtered));
    }

    function queueMainEntryPersonalNameValidation(fieldContext, settings, state) {
        if (!isMainEntryNameGuardrailEnabled(settings) || !fieldContext) return;
        if (fieldContext.tag !== '100') return;
        const occurrence = normalizeOccurrenceKey(fieldContext.occurrence);
        const subA = (fieldContext.subfields || []).find(sub => sub && (sub.code || '').toLowerCase() === 'a');
        if (!subA) return;
        if (isExcluded(settings, state, fieldContext.tag, 'a')) return;
        const current = (subA.value || '').toString();
        const trimmed = current.trim();
        const meta = { tag: '100', code: 'a', occurrence };
        if (!trimmed) {
            updateMainEntryNameFindings(state, meta, []);
            return;
        }
        const findings = [];
        if (looksLikeMultiNameWithoutComma(trimmed)) {
            findings.push(buildMainEntryNameCommaFinding(meta, current));
        }
        if (trimmed.includes(',')) {
            const expected = normalizeMainEntryNameValue(trimmed);
            if (expected && expected !== trimmed) {
                findings.push(buildMainEntryNameCommaSpacingFinding(meta, current, expected));
            }
        }
        if (/\.\s*$/.test(trimmed) && !endsWithInitialPeriod(trimmed)) {
            const expected = trimmed.replace(/\.\s*$/, '');
            if (expected && expected !== trimmed) {
                findings.push(buildMainEntryNameTerminalPeriodFinding(meta, current, expected));
            }
        }
        updateMainEntryNameFindings(state, meta, findings);
    }

    const STATEMENT_LOWER_WORDS = new Set([
        'by', 'edited', 'editor', 'editors', 'ed', 'eds', 'ed.',
        'illustrated', 'illustrator', 'illustrators', 'illus', 'illus.',
        'translated', 'translator', 'translators', 'trans', 'trans.',
        'compiled', 'compiler', 'compilers', 'comp', 'comp.',
        'adapted', 'adapter', 'adapters', 'arranged', 'arranger', 'arrangers',
        'selected', 'selection', 'introduction', 'preface', 'foreword', 'afterword',
        'commentary', 'notes', 'with', 'and', 'or', 'from', 'for', 'based', 'upon',
        'rev', 'revised', 'revision', 'abridged'
    ]);

    function titleCaseName(text) {
        return (text || '').split(/\s+/).map(word => toNameTitleWord(word)).join(' ');
    }

    function toNameTitleWord(word) {
        if (!word) return word;
        const match = word.match(/^([("'\\[]*)([A-Za-z][A-Za-z'.-]*)([^A-Za-z]*)$/);
        if (!match) return word;
        const leading = match[1] || '';
        const core = match[2] || '';
        const trailing = match[3] || '';
        if (core.toUpperCase() === core && core.length <= 3) {
            return `${leading}${core}${trailing}`;
        }
        if (/^Mc[A-Za-z]/.test(core)) {
            const rest = core.slice(2);
            return `${leading}Mc${rest.charAt(0).toUpperCase()}${rest.slice(1).toLowerCase()}${trailing}`;
        }
        if (core.includes("'")) {
            const parts = core.split("'");
            const fixed = parts.map(part => part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : '').join("'");
            return `${leading}${fixed}${trailing}`;
        }
        return `${leading}${core.charAt(0).toUpperCase()}${core.slice(1).toLowerCase()}${trailing}`;
    }

    function normalizeStatementStopwords(text) {
        return (text || '').split(/\s+/).map(word => normalizeStatementWord(word)).join(' ');
    }

    function normalizeStatementWord(word) {
        if (!word) return word;
        const match = word.match(/^([("'\\[]*)([A-Za-z][A-Za-z'.-]*)([^A-Za-z]*)$/);
        if (!match) return word;
        const leading = match[1] || '';
        const core = match[2] || '';
        const trailing = match[3] || '';
        const lowered = core.toLowerCase();
        if (STATEMENT_LOWER_WORDS.has(lowered)) {
            return `${leading}${lowered}${trailing}`;
        }
        return word;
    }

    function applyStatementDecorations(original, normalized) {
        const raw = (original || '').toString();
        let expected = (normalized || '').toString().trim();
        if (!expected) return '';
        const prefixMatch = raw.match(/^\s*\/\s*/);
        if (prefixMatch && prefixMatch[0] && !expected.startsWith(prefixMatch[0])) {
            expected = prefixMatch[0] + expected;
        }
        const suffixMatch = raw.match(/[.?!]\s*$/);
        if (suffixMatch && suffixMatch[0]) {
            const suffix = suffixMatch[0].trim();
            if (suffix && !expected.endsWith(suffix)) {
                expected += suffix;
            }
        }
        return expected;
    }

    function buildStatementCaseFinding(meta, current, expected) {
        return {
            severity: 'WARNING',
            code: STATEMENT_CASE_FINDING_CODE,
            message: 'Normalize casing for statement of responsibility.',
            rationale: 'Local Title Case normalization suggests a different capitalization.',
            tag: meta.tag,
            subfield: meta.code,
            occurrence: normalizeOccurrenceKey(meta.occurrence),
            current_value: current,
            expected_value: expected,
            proposed_fixes: [{
                label: 'Normalize casing',
                patch: [{
                    op: 'replace_subfield',
                    tag: meta.tag,
                    code: meta.code,
                    value: expected
                }]
            }]
        };
    }

    function updateStatementCaseFinding(state, meta, finding) {
        if (!state || !meta) return;
        const key = `${meta.tag}${meta.code}:${normalizeOccurrenceKey(meta.occurrence)}`;
        const list = state.findings.get(key) || [];
        const filtered = list.filter(item => item.code !== STATEMENT_CASE_FINDING_CODE);
        if (finding) filtered.push(finding);
        state.findings.set(key, dedupeFindings(filtered));
    }

    function collectFindingsForField(state, tag, occurrence) {
        const list = [];
        if (!state || !state.findings) return list;
        const suffix = `:${normalizeOccurrenceKey(occurrence)}`;
        state.findings.forEach((items, key) => {
            if (key.startsWith(tag) && key.endsWith(suffix)) {
                items.forEach(item => list.push(item));
            }
        });
        return list;
    }

    function queueStatementCaseValidation(fieldContext, settings, state) {
        if (!isStatementCaseEnabled(settings) || !fieldContext) return;
        if (fieldContext.tag !== '245') return;
        const occurrence = normalizeOccurrenceKey(fieldContext.occurrence);
        fieldContext.subfields.forEach(sub => {
            if (!sub || (sub.code || '').toLowerCase() !== 'c') return;
            if (isExcluded(settings, state, fieldContext.tag, sub.code)) return;
            const meta = { tag: fieldContext.tag, code: sub.code, occurrence };
            scheduleStatementCaseCheck(meta, sub.value || '', settings, state);
        });
    }

    function queueStatementCaseRecordValidations(settings, state) {
        if (!isStatementCaseEnabled(settings) && !isMainEntryNameGuardrailEnabled(settings)) return;
        const record = buildRecordContext();
        (record.fields || []).forEach(field => {
            if (!field) return;
            const ctx = buildFieldContext(field.tag, field.occurrence || '');
            if (!ctx) return;
            if (field.tag === '245') {
                queueStatementCaseValidation(ctx, settings, state);
            }
            if (field.tag === '100') {
                queueMainEntryPersonalNameValidation(ctx, settings, state);
            }
        });
    }

    function scheduleStatementCaseCheck(meta, value, settings, state) {
        if (!state || !meta) return;
        const key = buildFieldKey(meta);
        const trimmed = (value || '').toString();
        if (!trimmed.trim()) {
            updateStatementCaseFinding(state, meta, null);
            updateSidePanel(state);
            updateGuardrails(settings, state);
            return;
        }
        if (state.statementCaseTimers.has(key)) {
            clearTimeout(state.statementCaseTimers.get(key));
        }
        const timer = setTimeout(() => {
            runStatementCaseCheck(meta, trimmed, settings, state);
        }, 250);
        state.statementCaseTimers.set(key, timer);
    }

    function runStatementCaseCheck(meta, value, settings, state) {
        if (!state || !meta) return;
        const key = buildFieldKey(meta);
        if (state.statementCaseTimers.has(key)) {
            clearTimeout(state.statementCaseTimers.get(key));
            state.statementCaseTimers.delete(key);
        }
        applyStatementCaseResult(meta, value, settings, state);
    }

    function applyStatementCaseResult(meta, requestedValue, settings, state) {
        const $field = findFieldElement(meta.tag, meta.code, meta.occurrence);
        if (!$field.length) return;
        const current = ($field.val() || '').toString();
        if (current !== requestedValue) return;
        const prefixMatch = current.match(/^\s*\/\s*/);
        const suffixMatch = current.match(/[.?!]\s*$/);
        let core = current;
        if (prefixMatch && prefixMatch[0]) {
            core = core.slice(prefixMatch[0].length);
        }
        if (suffixMatch && suffixMatch[0]) {
            core = core.slice(0, Math.max(0, core.length - suffixMatch[0].length));
        }
        const fallback = normalizeStatementStopwords(titleCaseName(core.trim()));
        let expectedCore = fallback || core.trim();
        if (meta.tag === '245' && meta.code === 'c') {
            expectedCore = normalizeStatementStopwords(expectedCore);
        }
        const expected = applyStatementDecorations(current, expectedCore);
        if (!expected || expected === current) {
            updateStatementCaseFinding(state, meta, null);
        } else {
            updateStatementCaseFinding(state, meta, buildStatementCaseFinding(meta, current, expected));
        }
        const fieldContext = buildFieldContext(meta.tag, meta.occurrence);
        if (fieldContext) {
            const combined = collectFindingsForField(state, meta.tag, meta.occurrence);
            updateIndicators(fieldContext, combined);
        }
        updateSidePanel(state);
        updateGuardrails(settings, state);
    }

    function countSeverity(findingsMap, severity) {
        let count = 0;
        findingsMap.forEach(list => {
            list.forEach(f => {
                if (f.severity === severity) count++;
            });
        });
        return count;
    }

    function applyAutoFixes(settings, state, meta, findings) {
        if (!state.autoApply || !settings.enabled || state.guideActive || state.readOnly) return;
        findings.forEach(finding => {
            const patch = finding.proposed_fixes && finding.proposed_fixes[0] && finding.proposed_fixes[0].patch[0];
            if (!patch) return;
            applyPatch(patch, finding.occurrence, finding);
        });
    }

    function applyPatch(patch, occurrence, finding) {
        const state = global.ISBDIntellisenseState;
        if (state && state.readOnly) {
            toast('warning', 'Punctuation apply is disabled in internship mode.');
            return;
        }
        if (patch.op !== 'replace_subfield') return;
        const code = patch.code || patch.subfield;
        const index = patch.subfield_index !== undefined ? patch.subfield_index : (finding && finding.subfield_index);
        const $field = findFieldElement(patch.tag, code, occurrence, index);
        if (!$field.length) return;
        const previous = $field.val() || '';
        if (finding && finding.current_value !== undefined && previous !== finding.current_value && previous !== patch.value) {
            toast('warning', 'Field value changed; punctuation patch skipped.');
            return;
        }
        if (previous === patch.value) return;
        const meta = parseFieldMeta($field[0]);
        const record = {
            tag: patch.tag,
            code: code,
            occurrence: occurrence || (meta ? meta.occurrence : '')
        };
        markFieldForRevalidation(state, meta || record);
        recordUndo(record, previous, patch.value);
        $field.val(patch.value);
        if (state && state.punctuationProvenance) {
            if (patch.punctuation_provenance) {
                state.punctuationProvenance.set($field[0], { ...patch.punctuation_provenance });
            } else {
                state.punctuationProvenance.delete($field[0]);
            }
        }
        $field.trigger('change');
        $field.trigger('input');
        const conditionToast = buildConditionalSuffixToast(finding);
        if (conditionToast) {
            toast('info', conditionToast);
        }
    }

    function applyAiPatch(patch, finding) {
        const state = global.ISBDIntellisenseState;
        if (state && state.readOnly) {
            toast('warning', 'Punctuation apply is disabled in internship mode.');
            return false;
        }
        if (!patch || patch.op !== 'replace_subfield') return false;
        const occurrence = patch.occurrence;
        const code = patch.subfield || patch.code;
        const index = patch.subfield_index !== undefined ? patch.subfield_index : (finding && finding.subfield_index);
        const $field = findFieldElement(patch.tag, code, occurrence, index);
        if (!$field.length) return false;
        const previous = $field.val() || '';
        if (patch.original_text !== undefined && patch.original_text !== previous) {
            toast('warning', 'Field value changed; AI patch skipped.');
            return false;
        }
        const nextValue = patch.replacement_text !== undefined ? patch.replacement_text : (patch.value !== undefined ? patch.value : '');
        if (previous === nextValue) return false;
        const meta = parseFieldMeta($field[0]);
        const record = {
            tag: patch.tag,
            code,
            occurrence: occurrence || (meta ? meta.occurrence : '')
        };
        markFieldForRevalidation(state, meta || record);
        recordUndo(record, previous, nextValue);
        $field.val(nextValue);
        if (state && state.punctuationProvenance) {
            state.punctuationProvenance.delete($field[0]);
        }
        $field.trigger('change');
        $field.trigger('input');
        const conditionToast = buildConditionalSuffixToast(finding);
        if (conditionToast) {
            toast('info', conditionToast);
        }
        return true;
    }

    function recordUndo(target, previousValue, nextValue) {
        const state = global.ISBDIntellisenseState;
        if (!state) return;
        if (state.redoStack) state.redoStack = [];
        state.undoStack.push({
            kind: target.kind || 'subfield',
            tag: target.tag,
            code: target.code,
            indicator: target.indicator,
            occurrence: target.occurrence || '',
            previous: previousValue,
            next: nextValue
        });
    }

    function updateIndicators(fieldContext, findings) {
        fieldContext.subfields.forEach(sub => {
            const $field = findFieldElement(fieldContext.tag, sub.code, fieldContext.occurrence);
            if (!$field.length) return;
            $field.siblings('.isbd-indicator').remove();
            const related = findings.filter(f => f.subfield === sub.code);
            if (!related.length) return;
            const highest = related.find(f => f.severity === 'ERROR') || related.find(f => f.severity === 'WARNING') || related[0];
            const tooltip = buildTooltip(highest);
            const badge = $(`<span class="isbd-indicator ${highest.severity.toLowerCase()}" title="${tooltip}">${highest.severity}</span>`);
            $field.after(badge);
        });
    }

    function buildTooltip(finding) {
        const example = finding.examples && finding.examples[0] ? `Example: ${finding.examples[0].before} -> ${finding.examples[0].after}` : '';
        return `${finding.message}\n${finding.rationale || ''}\n${example}`.trim();
    }

    function compareRequiredTokensForPanel(a, b) {
        const left = parseRequiredFieldToken(a) || { tag: '999', code: 'z' };
        const right = parseRequiredFieldToken(b) || { tag: '999', code: 'z' };
        const leftTag = Number.parseInt(left.tag || '999', 10);
        const rightTag = Number.parseInt(right.tag || '999', 10);
        if (leftTag !== rightTag) return leftTag - rightTag;
        const rank = code => {
            const normalized = normalizeSubfieldCode(code);
            if (normalized === '*') return -1;
            if (/^\d$/.test(normalized)) return Number.parseInt(normalized, 10);
            if (/^[a-z]$/i.test(normalized)) return 100 + normalized.charCodeAt(0);
            return 999;
        };
        const leftRank = rank(left.code);
        const rightRank = rank(right.code);
        if (leftRank !== rightRank) return leftRank - rightRank;
        return String(left.code || '').localeCompare(String(right.code || ''));
    }

    function updateSidePanel(state) {
        const $container = $('#isbd-findings');
        if (!$container.length) return;
        $container.empty();
        let total = 0;
        const isReadOnly = state && state.readOnly;
        const readOnlyAttr = isReadOnly ? 'disabled title="Disabled in internship mode."' : '';
        if (state.guardrailAlerts && state.guardrailAlerts.length) {
            state.guardrailAlerts.forEach(alert => {
                total++;
                const hasTarget = !!(
                    alert
                    && alert.tag
                    && alert.subfield !== undefined
                    && alert.subfield !== null
                    && alert.subfield !== ''
                );
                const action = hasTarget
                    ? `<button type="button" class="btn btn-xs isbd-btn-yellow" data-tag="${alert.tag}" data-sub="${alert.subfield}">Go to field</button>`
                    : '';
                const item = $(`
                    <div class="finding warning">
                        <div><strong>${alert.label || 'Guardrail'}</strong> · WARNING</div>
                        <div class="meta">${alert.message || 'Required MARC21 data is missing.'}</div>
                        <div class="actions">${action}</div>
                    </div>
                `);
                if (hasTarget) {
                    item.find('button').on('click', (event) => {
                        const $btn = $(event.currentTarget);
                        const targetTag = $btn.attr('data-tag') || '';
                        const targetSub = $btn.attr('data-sub') || '';
                        if (targetSub === '*') {
                            focusTagField(targetTag);
                        } else {
                            focusField(targetTag, targetSub, '');
                        }
                    });
                }
                $container.append(item);
            });
        }
        if (state.missingRequired.length) {
            const sortedMissingRequired = state.missingRequired.slice().sort(compareRequiredTokensForPanel);
            sortedMissingRequired.forEach(code => {
                const parsed = parseRequiredFieldToken(code);
                if (!parsed) return;
                total++;
                const tag = parsed.tag;
                const sub = parsed.code;
                const isFieldLevel = sub === '*';
                const label = isFieldLevel ? `${tag} (any subfield)` : `${tag}$${sub}`;
                const message = isFieldLevel
                    ? 'Required MARC21 field is missing (no subfield value present).'
                    : 'Required MARC21 field is missing.';
                const item = $(`
                    <div class="finding warning">
                        <div><strong>${label}</strong> · WARNING</div>
                        <div class="meta">${message}</div>
                        <div class="actions">
                            <button type="button" class="btn btn-xs isbd-btn-yellow" data-tag="${tag}" data-sub="${sub}">Go to field</button>
                        </div>
                    </div>
                `);
                item.find('button').on('click', (event) => {
                    const $btn = $(event.currentTarget);
                    const targetTag = $btn.attr('data-tag') || '';
                    const targetSub = $btn.attr('data-sub') || '';
                    if (targetSub === '*') {
                        focusTagField(targetTag);
                    } else {
                        focusField(targetTag, targetSub, '');
                    }
                });
                $container.append(item);
            });
        }
        state.findings.forEach(list => {
            list.forEach(finding => {
                if (isFindingIgnored(state, finding)) return;
                total++;
                const severityClass = (finding.severity || 'info').toLowerCase();
                const helpText = buildHelpText(finding);
                const conditionNote = buildConditionalSuffixNote(finding);
                const conditionHtml = conditionNote ? `<div class="meta">${escapeAttr(conditionNote)}</div>` : '';
                const helpIcon = (finding.severity === 'ERROR' || finding.severity === 'WARNING')
                    ? `<span class="isbd-help" title="${escapeAttr(helpText)}">?</span>`
                    : '';
                const preview = finding.expected_value ? `<div class="isbd-preview">${escapeAttr(finding.current_value || '')} → ${escapeAttr(finding.expected_value)}</div>` : '';
                const rawExcerpt = finding.raw_text_excerpt ? escapeAttr(finding.raw_text_excerpt) : '';
                const rawHtml = rawExcerpt
                    ? `<div class="isbd-raw-wrapper">
                            <button type="button" class="btn btn-xs btn-default isbd-raw-toggle">View raw output</button>
                            <pre class="isbd-raw-output">${rawExcerpt}</pre>
                        </div>`
                    : '';
                const patch = finding.proposed_fixes && finding.proposed_fixes[0] && finding.proposed_fixes[0].patch[0];
                const hasPatch = !!patch;
                const applyAttr = hasPatch ? readOnlyAttr : 'disabled title="No automatic fix available."';
                const item = $(`
                    <div class="finding ${severityClass}">
                        <div><strong>${finding.tag}$${finding.subfield}</strong> · ${finding.severity} ${helpIcon}</div>
                        <div class="meta">${escapeAttr(finding.message || '')}</div>
                        ${conditionHtml}
                        ${preview}
                        ${rawHtml}
                        <div class="actions">
                            <button type="button" class="btn btn-xs isbd-btn-yellow isbd-go-field" data-tag="${finding.tag}" data-sub="${finding.subfield}" data-occ="${normalizeOccurrenceKey(finding.occurrence)}">Go to field</button>
                            <button type="button" class="btn btn-xs btn-primary isbd-apply" ${applyAttr}>Apply</button>
                            <button type="button" class="btn btn-xs isbd-btn-danger isbd-ignore">Ignore</button>
                        </div>
                    </div>
                `);
                item.find('.isbd-go-field').on('click', () => {
                    focusField(finding.tag, finding.subfield, finding.occurrence);
                });
                item.find('.isbd-apply').on('click', () => {
                    if (isReadOnly) {
                        toast('warning', 'Punctuation apply is disabled in internship mode.');
                        return;
                    }
                    if (!hasPatch) {
                        toast('info', 'No automatic fix is available for this finding.');
                        return;
                    }
                    const conditionToast = buildConditionalSuffixToast(finding);
                    applyPatch(patch, finding.occurrence, finding);
                    if (!conditionToast) {
                        toast('info', `ISBD punctuation applied to ${finding.tag}$${finding.subfield}.`);
                    }

                });
                item.find('.isbd-ignore').on('click', () => {
                    ignoreFinding(state, finding);
                    updateSidePanel(state);
                });
                item.find('.isbd-raw-toggle').on('click', function() {
                    const $raw = item.find('.isbd-raw-output');
                    const isVisible = $raw.is(':visible');
                    $raw.toggle(!isVisible);
                    $(this).text(isVisible ? 'View raw output' : 'Hide raw output');
                });
                $container.append(item);
            });
        });
        if (!total) {
            $container.append('<div class="meta">No ISBD findings yet.</div>');
        }
    }

    function updateGuardrails(settings, state) {
        const missing = [];
        const seen = new Set();
        const requiredTokens = getRequiredFieldTokens(state);
        requiredTokens.forEach(code => {
            const parsed = parseRequiredFieldToken(code);
            if (!parsed) return;
            const key = `${parsed.tag}${parsed.code}`;
            if (seen.has(key)) return;
            seen.add(key);
            const present = parsed.code === '*'
                ? anyTagHasAnySubfieldValue(parsed.tag)
                : anyFieldHasValue(parsed.tag, parsed.code);
            if (!present) missing.push(key);
        });
        state.missingRequired = missing;
        state.guardrailAlerts = [];
        const errorCount = countSeverity(state.findings, 'ERROR');
        const missingCount = missing.length;
        const total = errorCount + missingCount;
        const status = total === 0 ? 'All guardrails satisfied' : `${total} issue(s) (${missingCount} required missing)`;
        $('#isbd-guardrail-status').text(`Guardrails: ${status}`);
    }

    function isInternFeatureAllowed(state, key) {
        if (typeof internFeatureAllowed === 'function') {
            return internFeatureAllowed(state, key);
        }
        return true;
    }

    function applyAllFindings(settings) {
        const state = global.ISBDIntellisenseState;
        if (!state) return;
        if (state.readOnly) {
            toast('warning', 'Punctuation apply is disabled in internship mode.');
            return;
        }
        const patches = [];
        const skipped = { ignored: 0, no_patch: 0, not_found: 0, unchanged: 0, changed: 0 };
        state.findings.forEach(list => {
            list.forEach(finding => {
                if (isFindingIgnored(state, finding)) { skipped.ignored++; return; }
                const patch = finding.proposed_fixes && finding.proposed_fixes[0] && finding.proposed_fixes[0].patch[0];
                if (!patch) { skipped.no_patch++; return; }
                patches.push({ patch, occurrence: finding.occurrence, finding });
            });
        });
        if (!patches.length) {
            const skippedTotal = Object.values(skipped).reduce((sum, value) => sum + value, 0);
            if (skippedTotal) {
                const reasons = Object.keys(skipped).filter(key => skipped[key]).map(key => `${skipped[key]} ${key.replace('_', ' ')}`).join(', ');
                toast('info', `No ISBD suggestions applied; skipped ${skippedTotal}: ${reasons}.`);
            } else {
                toast('info', 'No ISBD suggestions to apply.');
            }
            return;
        }
        let applied = 0;
        patches.forEach(item => {
            const code = item.patch.code || item.patch.subfield;
            const index = item.patch.subfield_index !== undefined ? item.patch.subfield_index : (item.finding && item.finding.subfield_index);
            const $field = findFieldElement(item.patch.tag, code, item.occurrence, index);
            if (!$field || !$field.length) { skipped.not_found++; return; }
            const current = $field.val() || '';
            const original = item.finding && item.finding.current_value !== undefined ? item.finding.current_value : undefined;
            if (original !== undefined && current !== original && current !== item.patch.value) { skipped.changed++; return; }
            if (current === item.patch.value) { skipped.unchanged++; return; }
            applyPatch(item.patch, item.occurrence, item.finding);
            applied++;
        });
        refreshAll(settings);
        const skippedTotal = Object.values(skipped).reduce((sum, value) => sum + value, 0);
        if (applied && skippedTotal) {
            const reasons = Object.keys(skipped).filter(key => skipped[key]).map(key => `${skipped[key]} ${key.replace('_', ' ')}`).join(', ');
            toast('info', `Applied ${applied} suggestion(s), skipped ${skippedTotal}: ${reasons}.`);
        } else if (applied) {
            toast('info', `Applied all ${applied} ISBD suggestion(s).`);
        } else {
            toast('info', 'No suggestions could be applied (fields not found or already correct).');
        }
    }

    function undoLastChange() {
        const state = global.ISBDIntellisenseState;
        if (!state || !state.undoStack.length) {
            toast('info', 'Nothing to undo.');
            return;
        }
        if (state.readOnly) {
            toast('warning', 'Undo is disabled in internship mode.');
            return;
        }
        const change = state.undoStack.pop();
        if (applyRecordedChange(change, 'previous')) {
            if (!state.redoStack) state.redoStack = [];
            state.redoStack.push(change);
            refreshAll(global.AutoPunctuationSettings || {});
            toast('info', 'Last change undone.');
        }
    }

    function redoLastChange() {
        const state = global.ISBDIntellisenseState;
        if (!state || !state.redoStack || !state.redoStack.length) {
            toast('info', 'Nothing to redo.');
            return;
        }
        if (state.readOnly) {
            toast('warning', 'Redo is disabled in internship mode.');
            return;
        }
        const change = state.redoStack.pop();
        if (applyRecordedChange(change, 'next')) {
            state.undoStack.push(change);
            refreshAll(global.AutoPunctuationSettings || {});
            toast('info', 'Last change redone.');
        }
    }

    function undoAllChanges() {
        const state = global.ISBDIntellisenseState;
        if (!state || !state.undoStack.length) {
            toast('info', 'Nothing to undo.');
            return;
        }
        if (state.readOnly) {
            toast('warning', 'Undo is disabled in internship mode.');
            return;
        }
        if (!state.redoStack) state.redoStack = [];
        while (state.undoStack.length) {
            const change = state.undoStack.pop();
            if (applyRecordedChange(change, 'previous')) {
                state.redoStack.push(change);
            }
        }
        refreshAll(global.AutoPunctuationSettings || {});
        toast('info', 'All changes undone.');
    }

    function applyRecordedChange(change, direction) {
        if (!change) return false;
        const value = direction === 'previous' ? change.previous : change.next;
        if ((change.kind || 'subfield') === 'indicator') {
            const indicator = Number(change.indicator || 0);
            if (!(indicator === 1 || indicator === 2)) return false;
            return setIndicatorValue(change.tag, indicator, change.occurrence, value || '');
        }
        const $field = findFieldElement(change.tag, change.code, change.occurrence);
        if (!$field.length) return false;
        $field.val(value || '');
        return true;
    }

    function refreshAll(settings) {
        const state = global.ISBDIntellisenseState;
        if (!state) return;
        const record = filterRecordContext(buildRecordContext(), settings, state);
        const result = global.ISBDRulesEngine.validateRecord(record, settings, state.rules, settings.strictCoverageMode);
        state.findings = groupFindings(result.findings);
        updateSidePanel(state);
        updateGuardrails(settings, state);
        queueStatementCaseRecordValidations(settings, state);
        notifyDependentFindingsAfterRefresh(state);
    }

    function maybeShowGhost(element, findings, settings, state) {
        $(element).siblings('.isbd-ghost-text').remove();
        if (!settings.enabled || state.readOnly) return;
        const meta = parseFieldMeta(element);
        if (!meta) return;
        const occurrenceKey = normalizeOccurrenceKey(meta.occurrence);
        const relevant = (findings || []).filter(finding => {
            if (!finding || !finding.expected_value) return false;
            if ((finding.severity || '').toUpperCase() === 'ERROR') return false;
            if ((finding.tag || '') !== meta.tag) return false;
            if ((finding.subfield || '').toLowerCase() !== (meta.code || '').toLowerCase()) return false;
            return normalizeOccurrenceKey(finding.occurrence || '') === occurrenceKey;
        });
        const candidate = relevant.find(f => (f.severity || '').toUpperCase() === 'WARNING') || relevant[0];
        if (!candidate) return;
        const ghostText = computeGhostText(candidate.current_value, candidate.expected_value);
        if (!ghostText) return;
        const $ghost = $(`<span class="isbd-ghost-text" title="Accept ISBD suggestion">${ghostText}</span>`);
        $ghost.data('expected', candidate.expected_value);
        $ghost.on('click', () => {
            $(element).val(candidate.expected_value);
            $ghost.remove();
            markFieldForRevalidation(state, parseFieldMeta(element));
            toast('info', 'ISBD ghost suggestion applied.');
        });
        $(element).after($ghost);
    }

    function computeGhostText(currentValue, expectedValue) {
        currentValue = currentValue === undefined || currentValue === null ? '' : String(currentValue);
        expectedValue = expectedValue === undefined || expectedValue === null ? '' : String(expectedValue);
        if (!currentValue || !expectedValue || currentValue === expectedValue) return '';
        if (expectedValue.startsWith(currentValue)) {
            return expectedValue.slice(currentValue.length);
        }
        if (expectedValue.endsWith(currentValue)) {
            return expectedValue.slice(0, expectedValue.length - currentValue.length);
        }
        let prefix = 0;
        const limit = Math.min(currentValue.length, expectedValue.length);
        while (prefix < limit && currentValue.charAt(prefix) === expectedValue.charAt(prefix)) {
            prefix += 1;
        }
        let suffix = 0;
        while (
            suffix < limit - prefix
            && currentValue.charAt(currentValue.length - 1 - suffix) === expectedValue.charAt(expectedValue.length - 1 - suffix)
        ) {
            suffix += 1;
        }
        const before = currentValue.slice(prefix, currentValue.length - suffix);
        const after = expectedValue.slice(prefix, expectedValue.length - suffix);
        const compact = value => {
            const text = String(value || '');
            if (text.length <= 28) return text;
            return `${text.slice(0, 12)}...${text.slice(-12)}`;
        };
        if (!before && after) return after;
        if (before && !after) return ` remove "${compact(before)}"`;
        if (before || after) return ` -> ${compact(after)}`;
        return '';
    }

    function updateAiPanelStatus($panel, message, type) {
        if (!$panel || !$panel.length) return;
        const $status = $panel.find('#isbd-ai-status');
        if (!$status.length) return;
        $status.removeClass('success error info warning').addClass(type || 'info');
        $status.text(message || '');
    }

    function updateAiCatalogingStatus($panel, message, type) {
        if (!$panel || !$panel.length) return;
        const $status = $panel.find('#isbd-ai-cataloging-status');
        if (!$status.length) return;
        $status.removeClass('success error info warning').addClass(type || 'info');
        $status.text(message || '');
    }

    function renderAiDebug($panel, context, result) {
        if (!$panel || !$panel.length) return;
        const debug = result && result.debug ? result.debug : null;
        const $details = $panel.find(`#isbd-ai-${context}-debug`);
        const $content = $panel.find(`#isbd-ai-${context}-debug-content`);
        if (!$details.length || !$content.length) return;
        if (!debug || (!debug.raw_provider_response && !debug.raw_text && !debug.parse_error)) {
            $details.hide();
            $content.text('');
            return;
        }
        const sections = [];
        if (debug.parse_error) sections.push(`Parse error: ${debug.parse_error}`);
        if (debug.raw_provider_response) sections.push(`Raw provider response:\n${debug.raw_provider_response}`);
        if (debug.raw_text && !debug.raw_provider_response) sections.push(`Raw text:\n${debug.raw_text}`);
        $content.text(sections.join('\n\n'));
        $details.show();
    }

    function confidencePercentFromResult(result) {
        if (result && typeof result.confidence_percent === 'number' && !Number.isNaN(result.confidence_percent)) {
            return Math.min(100, Math.max(0, Math.round(result.confidence_percent)));
        }
        const findings = result && Array.isArray(result.findings) ? result.findings : [];
        const values = findings
            .map(finding => (finding && typeof finding.confidence === 'number' ? finding.confidence : null))
            .filter(value => value !== null && value >= 0 && value <= 1);
        if (!values.length) return 50;
        const avg = values.reduce((acc, val) => acc + val, 0) / values.length;
        return Math.min(100, Math.max(0, Math.round(avg * 100)));
    }

    function summarizeFindings(findings) {
        if (!Array.isArray(findings) || !findings.length) return '';
        const lines = [];
        findings.forEach(finding => {
            if (!finding) return;
            const message = (finding.message || '').trim();
            const rationale = (finding.rationale || '').trim();
            if (message && rationale && message !== rationale) {
                lines.push(`${message} - ${rationale}`);
            } else if (message) {
                lines.push(message);
            } else if (rationale) {
                lines.push(rationale);
            }
        });
        return lines.join('\n');
    }

    function summarizeIssues(issues) {
        if (!Array.isArray(issues) || !issues.length) return '';
        return issues.map(issue => {
            if (!issue) return '';
            const message = (issue.message || '').trim();
            const suggestion = (issue.suggestion || '').trim();
            if (message && suggestion && message !== suggestion) return `${message} - ${suggestion}`;
            return message || suggestion || '';
        }).filter(Boolean).join('\n');
    }

    function groupIssuesByField(issues) {
        const grouped = new Map();
        (issues || []).forEach(issue => {
            if (!issue) return;
            const tag = issue.tag || '';
            const subfield = issue.subfield || '';
            const key = `${tag}$${subfield}`;
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(issue);
        });
        return grouped;
    }

    function collectAiPunctuationPatches(findings) {
        const patches = [];
        if (!Array.isArray(findings)) return patches;
        findings.forEach((finding, findingIndex) => {
            const fixes = Array.isArray(finding.proposed_fixes) ? finding.proposed_fixes : [];
            fixes.forEach((fix, fixIndex) => {
                const patchList = Array.isArray(fix.patch) ? fix.patch : [];
                patchList.forEach((patch, patchIndex) => {
                    if (!patch) return;
                    patches.push({
                        id: `${findingIndex}-${fixIndex}-${patchIndex}`,
                        finding,
                        patch
                    });
                });
            });
        });
        return patches;
    }

    function formatAiPatchLabel(item) {
        if (!item || !item.patch) return '';
        const patch = item.patch;
        const tag = patch.tag || '';
        const code = patch.subfield || patch.code || '';
        const original = patch.original_text !== undefined ? patch.original_text : (patch.current_value || '');
        const replacement = patch.replacement_text !== undefined ? patch.replacement_text : (patch.value !== undefined ? patch.value : '');
        if (original && replacement && original !== replacement) {
            return `${tag}$${code}: "${original}" -> "${replacement}"`;
        }
        return `${tag}$${code}: ${replacement || original}`.trim();
    }

    function renderAiPunctuationResults($panel, settings, state, meta, result) {
        if (!$panel || !$panel.length) return;
        const $summary = $panel.find('#isbd-ai-punctuation-summary');
        const $list = $panel.find('#isbd-ai-punctuation-list');
        const $actions = $panel.find('#isbd-ai-punctuation-actions');
        const findings = Array.isArray(result && result.findings) ? result.findings : [];
        const issues = Array.isArray(result && result.issues) ? result.issues : [];
        const patches = collectAiPunctuationPatches(findings);
        const assistantText = (result && result.assistant_message ? String(result.assistant_message).trim() : '');
        const summaryText = summarizeIssues(issues) || summarizeFindings(findings) || 'No deterministic punctuation finding.';
        const summary = `Verified rule: ${summaryText}${assistantText ? `\nAI explanation (review required): ${assistantText}` : ''}`;

        if (state) {
            state.aiPunctuation = {
                findings,
                patches,
                summary,
                meta: meta || null
            };
        }

        if ($summary.length) $summary.text(summary);
        $list.empty();

        if (issues.length) {
            const grouped = groupIssuesByField(issues);
            grouped.forEach((items, key) => {
                const $group = $('<div class="isbd-ai-result-item"></div>');
                $group.append(`<div><strong>${escapeAttr(key)}</strong></div>`);
                items.forEach(issue => {
                    const severity = (issue.severity || '').toUpperCase();
                    const message = (issue.message || '').trim();
                    const suggestion = (issue.suggestion || '').trim();
                    const ruleBasis = (issue.rule_basis || '').trim();
                    const snippet = (issue.snippet || issue.selector || '').trim();
                    if (message) $group.append(`<div>${escapeAttr(message)}</div>`);
                    if (suggestion) $group.append(`<div class="isbd-ai-result-meta">Suggestion: ${escapeAttr(suggestion)}</div>`);
                    if (ruleBasis) $group.append(`<div class="isbd-ai-result-meta">Rule basis: ${escapeAttr(ruleBasis)}</div>`);
                    if (snippet) $group.append(`<div class="isbd-ai-result-meta">Snippet: ${escapeAttr(snippet)}</div>`);
                    if (severity) $group.append(`<div class="isbd-ai-result-meta">Severity: ${escapeAttr(severity)}</div>`);
                });
                $list.append($group);
            });
        }
        if (patches.length) {
            if (issues.length) {
                $list.append('<div class="meta" style="margin-top:6px;">Applyable patches:</div>');
            }
            patches.forEach((item, index) => {
                const label = formatAiPatchLabel(item) || (item.finding && item.finding.message) || 'Suggested update';
                const $row = $(`
                    <div class="isbd-ai-result-item">
                        <label>
                            <input type="checkbox" class="isbd-ai-result-checkbox" data-index="${index}" checked/>
                            <span>${escapeAttr(label)}</span>
                        </label>
                    </div>
                `);
                $list.append($row);
            });
            const readOnly = state && state.readOnly;
            const canApply = isInternFeatureAllowed(state, 'aiApplyActions') && !readOnly;
            $actions.show();
            $actions.find('button').prop('disabled', !canApply);
        } else if (!issues.length && findings.length) {
            findings.forEach(finding => {
                const message = (finding.message || '').trim();
                const rationale = (finding.rationale || '').trim();
                if (!message && !rationale) return;
                const $row = $('<div class="isbd-ai-result-item"></div>');
                if (message) $row.append(`<div><strong>Verified rule:</strong> ${escapeAttr(message)}</div>`);
                if (rationale && rationale !== message) {
                    $row.append(`<div class="isbd-ai-result-meta">${escapeAttr(rationale)}</div>`);
                }
                $list.append($row);
            });
            $actions.hide();
        } else if (!issues.length && !patches.length) {
            $list.append('<div class="meta">(none)</div>');
            $actions.hide();
        } else if (!patches.length) {
            $actions.hide();
        }
    }

    function applySelectedAiPatches(state) {
        if (state && (!isInternFeatureAllowed(state, 'aiApplyActions') || state.readOnly)) {
            toast('warning', 'AI apply actions are disabled in internship mode.');
            return;
        }
        const $panel = $('#isbd-ai-panel');
        const patches = state && state.aiPunctuation ? state.aiPunctuation.patches || [] : [];
        if (!patches.length) {
            toast('info', 'No AI rule or punctuation suggestions to apply.');
            return;
        }
        const selected = $panel.find('#isbd-ai-punctuation-list input[type="checkbox"]:checked');
        if (!selected.length) {
            toast('info', 'No AI suggestions selected.');
            return;
        }
        let applied = 0;
        selected.each(function() {
            const idx = Number($(this).data('index'));
            const item = patches[idx];
            if (!item || !item.patch) return;
            if (applyAiPatch(item.patch, item.finding)) applied += 1;
        });
        if (applied) {
            toast('info', `Applied ${applied} AI punctuation suggestion${applied > 1 ? 's' : ''}.`);
        }
    }

    function applyAllAiPatches(state) {
        if (state && (!isInternFeatureAllowed(state, 'aiApplyActions') || state.readOnly)) {
            toast('warning', 'AI apply actions are disabled in internship mode.');
            return;
        }
        const patches = state && state.aiPunctuation ? state.aiPunctuation.patches || [] : [];
        if (!patches.length) {
            toast('info', 'No AI rule or punctuation suggestions to apply.');
            return;
        }
        let applied = 0;
        patches.forEach(item => {
            if (!item || !item.patch) return;
            if (applyAiPatch(item.patch, item.finding)) applied += 1;
        });
        if (applied) {
            toast('info', `Applied ${applied} AI punctuation suggestion${applied > 1 ? 's' : ''}.`);
        }
    }

    function updateAiPanelSelection($panel, settings, state) {
        if (!$panel || !$panel.length) return { element: null, meta: null };
        const element = resolveAiTargetElement(state);
        const meta = element ? parseFieldMeta(element) : null;
        const $runBtn = $panel.find('#isbd-ai-panel-run');
        const requestState = getAiRequestState(state, 'punctuation');
        const inFlight = requestState && requestState.inFlight;
        const punctuationAllowed = isInternFeatureAllowed(state, 'aiPunctuation');
        if (!meta) {
            $panel.data('targetElement', null);
            $panel.data('targetMeta', null);
            $panel.find('#isbd-ai-selected').text('None');
            $panel.find('#isbd-ai-current').text('(no MARC field selected)');
            if ($runBtn.length) $runBtn.prop('disabled', true);
            if (!inFlight) {
                updateAiPanelStatus($panel, 'Select a MARC field to enable rule and punctuation suggestions.', 'info');
            }
            return { element: null, meta: null };
        }
        const currentValue = ($(element).val() || '').toString();
        const fieldContext = buildFieldContext(meta.tag, meta.occurrence);
        const hasValue = currentValue.trim().length > 0;
        const excluded = isExcluded(settings, state, meta.tag, meta.code);
        const covered = !!(global.ISBDRulesEngine
            && typeof global.ISBDRulesEngine.isFieldCovered === 'function'
            && global.ISBDRulesEngine.isFieldCovered(
                meta.tag,
                meta.code,
                (fieldContext && fieldContext.ind1) || '',
                (fieldContext && fieldContext.ind2) || '',
                (state && state.rules) || []
            ));
        const label = `${meta.tag}$${meta.code}${meta.occurrence ? ` (${meta.occurrence})` : ''}`;
        $panel.data('targetElement', element);
        $panel.data('targetMeta', meta);
        $panel.find('#isbd-ai-selected').text(label);
        $panel.find('#isbd-ai-current').text(currentValue || '(empty)');
        if ($runBtn.length) {
            $runBtn.prop('disabled', !punctuationAllowed || !hasValue || excluded || !covered);
        }
        if (!inFlight) {
            if (!punctuationAllowed) {
                updateAiPanelStatus($panel, 'AI punctuation requests are disabled for this internship profile.', 'warning');
            } else if (!hasValue) {
                updateAiPanelStatus($panel, `Enter a value in ${label} to run rules and punctuation suggestions.`, 'info');
            } else if (excluded) {
                updateAiPanelStatus($panel, `AI assistance is disabled for excluded field ${meta.tag}$${meta.code}.`, 'warning');
            } else if (!covered) {
                updateAiPanelStatus($panel, 'No ISBD rule defined for this field; AI assistance disabled.', 'warning');
            } else {
                updateAiPanelStatus($panel, '', 'info');
            }
        }
        return { element, meta };
    }

    function formatCatalogingResponseHtml(text) {
        const raw = (text || '').toString().replace(/\r\n?/g, '\n').trim();
        if (!raw) return 'No safe cataloguing rationale was available.';
        return raw.split('\n').map(line => {
            const escaped = escapeAttr(line || '');
            return escaped.replace(
                /^(\s*)(Classification|Subjects|Confidence|Rationale)(\s*:)/i,
                '$1<strong>$2</strong>$3'
            );
        }).join('<br/>');
    }

    function selectedCallNumberPrefix($panel) {
        if (!$panel || !$panel.length) return '';
        const value = $panel.find('input[name="isbd-ai-prefix-type"]:checked').val();
        return (value || '').toString().trim();
    }

    function apply942PartsEnabled($panel) {
        if (!$panel || !$panel.length) return false;
        return !!$panel.find('#isbd-ai-apply-942-parts').is(':checked');
    }

    function storePendingItemCallNumber(callNumber) {
        const value = (callNumber || '').toString().trim();
        if (!value) return;
        try {
            if (window.sessionStorage) {
                window.sessionStorage.setItem('isbdPendingItemCallNumber', value);
            }
        } catch (err) {
            // ignore storage failures
        }
    }

    function resolveTagOccurrence(tag, preferredCodes) {
        if (!tag) return '';
        const codes = Array.isArray(preferredCodes) && preferredCodes.length ? preferredCodes : ['a'];
        for (const code of codes) {
            const $field = findFieldElement(tag, code, '');
            if ($field && $field.length) {
                const meta = parseFieldMeta($field[0]);
                return meta ? (meta.occurrence || '') : '';
            }
        }
        return '';
    }

    function ensureSubfieldInputFlexible(tag, occurrence, code) {
        const existing = findFieldElement(tag, code, occurrence);
        if (existing && existing.length) return existing;
        let $created = ensureSubfieldInput(tag, occurrence, code);
        if ($created && $created.length) return $created;
        const baseCodes = ['a', 'c', 'h', 'i', 'k', 'm', 'b', 'n', 'p', 'q'];
        for (const baseCode of baseCodes) {
            const $base = findFieldElement(tag, baseCode, occurrence);
            if ($base && $base.length && typeof cloneSubfieldRow === 'function') {
                $created = cloneSubfieldRow($base, tag, code, occurrence);
                if ($created && $created.length) return $created;
            }
        }
        return $();
    }

    function setTargetSubfieldValueWithUndo($field, target, nextValue, state) {
        if (!$field || !$field.length || !target) return false;
        const previous = ($field.val() || '').toString();
        const next = (nextValue || '').toString();
        if (previous === next) return false;
        recordUndo(target, previous, next);
        $field.val(next);
        $field.trigger('change');
        markFieldForRevalidation(state, target);
        return true;
    }

    function updateAiCatalogingContext($panel, settings, state) {
        if (!$panel || !$panel.length) return {};
        const titleInfo = getTitleWithSubtitle();
        const cutterSource = getPreferredCutterSource();
        const yearInfo = getPublicationYear();
        const aiSuggestions = (state && state.aiSuggestions) ? state.aiSuggestions : { classification: '', subjects: [], confidence: null, errors: [] };
        const classificationInput = $panel.find('#isbd-ai-classification-input').val() || '';
        const aiRangeError = Array.isArray(aiSuggestions.errors)
            ? (aiSuggestions.errors.find(err => err && err.code === 'CLASSIFICATION_RANGE') || null)
            : null;
        const inputRangeMessage = classificationRangeMessage(classificationInput);
        const suggestionRangeMessage = classificationRangeMessage(aiSuggestions.classification || '');
        const rangeMessage = inputRangeMessage || suggestionRangeMessage || (aiRangeError ? aiRangeError.message : '');
        const classificationRaw = rangeMessage ? '' : (classificationInput || aiSuggestions.classification || '');
        const normalizedClassification = sanitizeAiClassificationSuggestion(classificationRaw);
        const classification = normalizedClassification || normalizeClassificationSuggestion(classificationRaw);
        const cutter = buildCutterSanborn(cutterSource.value || '', cutterSource.tag || '');
        const year = yearInfo.value || '';
        const prefix = selectedCallNumberPrefix($panel);
        const callNumberParts = buildCallNumberParts(classification, cutter, year, prefix);
        const callNumber = callNumberParts.full;
        const readOnly = !!(state && state.readOnly);
        const catalogingAllowed = isInternFeatureAllowed(state, 'aiCataloging');
        const aiApplyAllowed = isInternFeatureAllowed(state, 'aiApplyActions');

        $panel.find('#isbd-ai-title').text(titleInfo.value || '(missing)');
        $panel.find('#isbd-ai-cutter-source').text(cutterSource.label || 'Title');
        $panel.find('#isbd-ai-cutter').text(cutter || '(no match)');
        $panel.find('#isbd-ai-year').text(year || '(n/a)');
        const previewText = rangeMessage ? '(range not allowed)' : (callNumber || '(waiting for classification)');
        $panel.find('#isbd-ai-callnumber-preview').text(previewText);
        $panel.find('#isbd-ai-classification').text(aiSuggestions.classification || 'No safe classification suggestion');
        const $classError = $panel.find('#isbd-ai-classification-error');
        if ($classError.length) {
            if (rangeMessage) {
                $classError.text(rangeMessage).show();
            } else {
                $classError.text('').hide();
            }
        }
        const confidence = typeof aiSuggestions.confidence === 'string'
            ? aiSuggestions.confidence
            : '(evidence not assessed)';
        $panel.find('#isbd-ai-confidence').text(confidence);
        const normalizedSubjects = normalizeSubjectObjects(aiSuggestions.subjects || []);
        if (state && state.aiSuggestions) {
            state.aiSuggestions.subjects = normalizedSubjects;
        }
        renderAiSubjectList($panel, normalizedSubjects);
        const evidenceVerification = aiSuggestions.evidenceVerification && typeof aiSuggestions.evidenceVerification === 'object'
            ? aiSuggestions.evidenceVerification
            : null;
        const evidenceTrustLabel = evidenceVerification && evidenceVerification.status === 'verified'
            ? 'LCCS 2024 schedule verified'
            : (evidenceVerification && evidenceVerification.status === 'no_match'
                ? 'No exact LCCS schedule match'
                : (evidenceVerification && evidenceVerification.status === 'unavailable'
                    ? 'LCCS verification unavailable'
                    : (normalizedClassification ? 'LCCS not verified' : 'Classification not requested')));
        const trustLabels = [
            '<strong>AI suggestion</strong>',
            evidenceTrustLabel,
            aiSuggestions.requiresHumanReview ? 'Review required' : ''
        ].filter(Boolean).join(' · ');
        const rationale = aiSuggestions.rationale && typeof aiSuggestions.rationale === 'object'
            ? aiSuggestions.rationale
            : { ai: '', system: aiSuggestions.rawText || '' };
        const rationaleBlocks = [];
        if ((rationale.ai || '').toString().trim()) {
            rationaleBlocks.push(`<strong>AI rationale</strong><br>${formatCatalogingResponseHtml(rationale.ai)}`);
        }
        if ((rationale.system || '').toString().trim()) {
            rationaleBlocks.push(`<strong>System note</strong><br>${formatCatalogingResponseHtml(rationale.system)}`);
        }
        if (!rationaleBlocks.length) {
            rationaleBlocks.push('<strong>System note</strong><br>No safe cataloguing rationale was available.');
        }
        $panel.find('#isbd-ai-response').html(`${trustLabels}<br>${rationaleBlocks.join('<br>')}`);
        const authorityUnavailable = aiSuggestions.authorityLookupStatus === 'service_unavailable'
            || aiSuggestions.authorityLookupStatus === 'invalid_authority_response';
        $panel.find('#isbd-ai-retry-authority').toggle(!!authorityUnavailable);

        const hasTitle = !!titleInfo.title;
        const selection = getAiCatalogingSelectionState($panel, settings);
        const $runBtn = $panel.find('#isbd-ai-run-cataloging');
        if ($runBtn.length) $runBtn.prop('disabled', !catalogingAllowed || !hasTitle || !selection.hasFeature);
        let status = '';
        if (!catalogingAllowed) {
            status = 'AI cataloging requests are disabled for this internship profile.';
        } else if (!hasTitle) {
            status = 'Title source requires 245$a. 245$n, 245$p, 245$b, and 245$c are included when present.';
        } else if (!selection.hasFeature) {
            status = 'Select classification and/or subjects to enable suggestions.';
        }
        const requestState = getAiRequestState(state, 'cataloging');
        const inFlight = requestState && requestState.inFlight;
        if (!inFlight) {
            updateAiCatalogingStatus($panel, status, hasTitle ? 'info' : 'error');
        }
        const $useSuggested = $panel.find('#isbd-ai-use-suggested-class');
        if ($useSuggested.length) {
            const hasManualClass = !!classificationInput.toString().trim() && !inputRangeMessage;
            const hasSuggestedClass = !!(aiSuggestions.classification || '').toString().trim() && !suggestionRangeMessage;
            $useSuggested.prop('disabled', !!(readOnly || !aiApplyAllowed || (!hasSuggestedClass && !hasManualClass)));
        }
        const $applyCall = $panel.find('#isbd-ai-apply-callnumber');
        if ($applyCall.length) {
            const hasCallData = !!callNumber;
            const target = findCallNumberTarget();
            const hasTarget = !!(target && target.$field && target.$field.length);
            $applyCall.prop('disabled', !!(inputRangeMessage || aiRangeError || readOnly || !aiApplyAllowed || !hasCallData || !hasTarget));
        }
        const $undoCall = $panel.find('#isbd-ai-undo-callnumber');
        if ($undoCall.length) {
            const hasUndo = !!(state && state.undoStack && state.undoStack.length);
            $undoCall.prop('disabled', !!(readOnly || !aiApplyAllowed || !hasUndo));
        }
        const $redoCall = $panel.find('#isbd-ai-redo-callnumber');
        if ($redoCall.length) {
            const hasRedo = !!(state && state.redoStack && state.redoStack.length);
            $redoCall.prop('disabled', !!(readOnly || !aiApplyAllowed || !hasRedo));
        }
        const $apply942 = $panel.find('#isbd-ai-apply-942-parts');
        if ($apply942.length) {
            $apply942.prop('disabled', !!(readOnly || !aiApplyAllowed));
        }
        updateAiCatalogingControls($panel, settings);
        return {
            titleInfo,
            cutterSource,
            year,
            classification,
            callNumber,
            classSegment: callNumberParts.classSegment,
            cutterSegment: callNumberParts.cutterSegment,
            cutter,
            prefix
        };
    }

    function getAiCatalogingSelectionState($panel, settings) {
        const classificationEnabled = !!(settings.aiCallNumberGuidance && $panel.find('#isbd-ai-opt-classification').is(':checked'));
        const subjectsEnabled = !!(settings.aiSubjectGuidance && $panel.find('#isbd-ai-opt-subjects').is(':checked'));
        const hasFeature = classificationEnabled || subjectsEnabled;
        let label = 'Suggest classification & subjects';
        if (classificationEnabled && !subjectsEnabled) label = 'Suggest classification';
        if (!classificationEnabled && subjectsEnabled) label = 'Suggest subjects';
        if (!classificationEnabled && !subjectsEnabled) label = 'Select cataloging options';
        return { classificationEnabled, subjectsEnabled, hasFeature, label };
    }

    function updateAiCatalogingControls($panel, settings) {
        if (!$panel || !$panel.length) return;
        const selection = getAiCatalogingSelectionState($panel, settings);
        const $button = $panel.find('#isbd-ai-run-cataloging');
        const state = global.ISBDIntellisenseState;
        const catalogingAllowed = isInternFeatureAllowed(state, 'aiCataloging');
        const aiApplyAllowed = isInternFeatureAllowed(state, 'aiApplyActions');
        if ($button.length) {
            $button.text(selection.label);
            $button.prop('disabled', $button.prop('disabled') || !selection.hasFeature || !catalogingAllowed);
        }
        const $itemButtons = $panel.find('.isbd-ai-subject-apply, .isbd-ai-subject-undo, .isbd-ai-subject-redo');
        if ($itemButtons.length) {
            $itemButtons.prop('disabled', !!(state && state.readOnly) || !aiApplyAllowed);
        }
    }

    function resolveAiTargetElement(state) {
        const active = document.activeElement;
        if (active && parseFieldMeta(active)) return active;
        if (state && state.lastFocusedField && document.contains(state.lastFocusedField)) {
            const meta = parseFieldMeta(state.lastFocusedField);
            if (meta) return state.lastFocusedField;
        }
        return null;
    }

    function showAiAssistPanel(settings, state) {
        if (!isInternFeatureAllowed(state, 'aiAssistToggle')) {
            toast('warning', 'AI Assist is disabled for this internship profile.');
            return;
        }
        let $panel = $('#isbd-ai-panel');
        if (!$panel.length) {
            $panel = $(`
                <div class="isbd-ai-panel" id="isbd-ai-panel" style="display:none;">
                    <header>
                        <span>AI Assist</span>
                        <div>
                            <button type="button" class="btn btn-xs isbd-btn-yellow" id="isbd-ai-panel-minimize">Minimize</button>
                            <button type="button" class="btn btn-xs isbd-btn-yellow" id="isbd-ai-panel-refresh">Refresh</button>
                            <button type="button" class="btn btn-xs isbd-btn-danger" id="isbd-ai-panel-close">Close</button>
                        </div>
                    </header>
                    <div class="body">
                        <div class="isbd-ai-section">
                            <div class="isbd-ai-section-title">Cataloging Suggestions</div>
                            <div class="meta">Title source (245$a + optional $n/$p/$b/$c): <strong id="isbd-ai-title">None</strong></div>
                            <div class="meta">Cutter source: <span id="isbd-ai-cutter-source">Title</span></div>
                            <div class="options">
                                <label><input type="checkbox" id="isbd-ai-opt-classification"> Classification number</label>
                                <label><input type="checkbox" id="isbd-ai-opt-subjects"> Subject headings</label>
                            </div>
                            <div class="isbd-ai-status-row">
                                <div id="isbd-ai-cataloging-status" class="isbd-status-text info"></div>
                                <button type="button" class="btn btn-xs isbd-btn-danger" id="isbd-ai-cancel-cataloging" style="display:none;">Cancel</button>
                            </div>
                            <div class="actions">
                                ${settings.aiPayloadPreview ? '<button type="button" class="btn btn-xs btn-default" id="isbd-ai-cataloging-preview">Preview</button>' : ''}
                                <button type="button" class="btn btn-xs btn-primary" id="isbd-ai-run-cataloging">Suggest classification &amp; subjects</button>
                            </div>
                            <div class="isbd-ai-results">
                                <div class="meta">Classification (LC): <span id="isbd-ai-classification">No suggestion requested yet</span></div>
                                <div class="meta">Confidence: <span id="isbd-ai-confidence">(n/a)</span></div>
                                <div class="meta">Subjects:</div>
                                <div id="isbd-ai-subjects" class="isbd-ai-text-output">No suggestion requested yet</div>
                                <div class="actions" style="justify-content: flex-start;">
                                    <label style="font-weight: normal;">
                                        <input type="checkbox" id="isbd-ai-subjects-replace"/>
                                        Replace existing subjects
                                    </label>
                                </div>
                                <div class="meta" style="margin-top: 6px;">AI rationale:</div>
                                <div id="isbd-ai-response" class="isbd-ai-text-output">No suggestion requested yet</div>
                                <div class="actions" style="justify-content:flex-start;">
                                    <button type="button" class="btn btn-xs btn-default" id="isbd-ai-retry-authority" style="display:none;">Retry authority verification</button>
                                </div>
                                <details class="isbd-ai-debug" id="isbd-ai-cataloging-debug" style="display:none;">
                                    <summary>Advanced/Debug</summary>
                                    <pre id="isbd-ai-cataloging-debug-content"></pre>
                                </details>
                            </div>
                            <div class="isbd-ai-callnumber">
                                <label for="isbd-ai-classification-input">Manual classification number</label>
                                <div class="isbd-ai-inline">
                                    <input type="text" id="isbd-ai-classification-input" class="form-control input-sm" placeholder="Enter classification"/>
                                    <button type="button" class="btn btn-xs btn-primary" id="isbd-ai-use-suggested-class">Apply</button>
                                </div>
                                <div class="meta" style="margin-top: 6px;">Collection prefix:</div>
                                <div class="isbd-ai-prefix-options">
                                    <label><input type="radio" name="isbd-ai-prefix-type" value="" checked/> None</label>
                                    <label><input type="radio" name="isbd-ai-prefix-type" value="Ref."/> Reference material</label>
                                    <label><input type="radio" name="isbd-ai-prefix-type" value="Spec. Col."/> Special collections</label>
                                    <label><input type="radio" name="isbd-ai-prefix-type" value="Fed. Doc."/> Federal documents</label>
                                    <label><input type="radio" name="isbd-ai-prefix-type" value="St. Doc."/> State documents</label>
                                    <label><input type="radio" name="isbd-ai-prefix-type" value="Juv. Col."/> Juvenile collection</label>
                                    <label><input type="radio" name="isbd-ai-prefix-type" value="Media"/> Media</label>
                                    <label><input type="radio" name="isbd-ai-prefix-type" value="Microform"/> Microform</label>
                                    <label><input type="radio" name="isbd-ai-prefix-type" value="Music"/> Music</label>
                                </div>
                                <div class="actions" style="justify-content:flex-start; margin-top:6px;">
                                    <label style="font-weight: normal;">
                                        <input type="checkbox" id="isbd-ai-apply-942-parts"/>
                                        Also apply to 942$h (classification), 942$i (cutter/year), and 942$k (prefix)
                                    </label>
                                </div>
                                <div id="isbd-ai-classification-error" class="isbd-ai-error" style="display:none;"></div>
                                <div class="isbd-ai-callnumber-hints">
                                    <div class="meta">Derived cutter: <span id="isbd-ai-cutter">(n/a)</span></div>
                                    <div class="meta">Publication year: <span id="isbd-ai-year">(n/a)</span></div>
                                    <div class="meta">Call number preview: <span id="isbd-ai-callnumber-preview">(waiting for classification)</span></div>
                                </div>
                                <div class="actions">
                                    <button type="button" class="btn btn-xs btn-primary" id="isbd-ai-apply-callnumber">Apply call number</button>
                                    <button type="button" class="btn btn-xs isbd-btn-yellow" id="isbd-ai-undo-callnumber">Undo</button>
                                    <button type="button" class="btn btn-xs isbd-btn-yellow" id="isbd-ai-redo-callnumber">Redo</button>
                                </div>
                            </div>
                        </div>
                        <hr/>
                        <div class="isbd-ai-section">
                            <div class="isbd-ai-section-title">Rules &amp; Punctuation Suggestions</div>
                            <div class="meta">Selected field: <strong id="isbd-ai-selected">None</strong></div>
                            <div class="meta">Field value:</div>
                            <div class="isbd-ai-field-value" id="isbd-ai-current"></div>
                            <div class="options">
                                <label><input type="checkbox" id="isbd-ai-opt-punctuation"> Include rationale (may be slower)</label>
                            </div>
                            <div class="isbd-ai-status-row" style="margin-top: 8px;">
                                <div id="isbd-ai-status" class="isbd-status-text info"></div>
                                <button type="button" class="btn btn-xs isbd-btn-danger" id="isbd-ai-cancel-punctuation" style="display:none;">Cancel</button>
                            </div>
                            <div class="actions">
                                ${settings.aiPayloadPreview ? '<button type="button" class="btn btn-xs btn-default" id="isbd-ai-panel-preview">Preview</button>' : ''}
                                <button type="button" class="btn btn-xs btn-primary" id="isbd-ai-panel-run">Run rules &amp; punctuation suggestions</button>
                            </div>
                            <div class="isbd-ai-results" id="isbd-ai-punctuation-results">
                                <div class="meta" id="isbd-ai-punctuation-summary">No rules or punctuation suggestions yet.</div>
                                <div id="isbd-ai-punctuation-list"></div>
                                <div class="isbd-ai-result-actions" id="isbd-ai-punctuation-actions" style="display:none;">
                                    <button type="button" class="btn btn-xs btn-primary" id="isbd-ai-apply-selected">Apply selected</button>
                                    <button type="button" class="btn btn-xs btn-default" id="isbd-ai-apply-all">Apply all</button>
                                </div>
                                <details class="isbd-ai-debug" id="isbd-ai-punctuation-debug" style="display:none;">
                                    <summary>Advanced/Debug</summary>
                                    <pre id="isbd-ai-punctuation-debug-content"></pre>
                                </details>
                            </div>
                        </div>
                    </div>
                </div>
            `);
            $('body').append($panel);
            makeAiPanelDraggable();
            $panel.find('#isbd-ai-panel-minimize').on('click', () => {
                setFloatingMinimized($panel, !$panel.hasClass('minimized'), '#isbd-ai-panel-minimize');
            });
            $panel.find('#isbd-ai-panel-close').on('click', () => {
                $panel.hide();
                if (state) state.aiPanelOpen = false;
                updateAiToggleButton();
            });
            $panel.find('#isbd-ai-panel-refresh').on('click', () => {
                updateAiPanelSelection($panel, settings, state);
                updateAiCatalogingContext($panel, settings, state);
            });
            $panel.find('#isbd-ai-cancel-punctuation').on('click', () => {
                const cancelled = cancelAiRequest(state, 'punctuation', 'Cancelled.', false);
                if (cancelled) updateAiPanelStatus($panel, 'Cancelled.', 'warning');
            });
            $panel.find('#isbd-ai-cancel-cataloging').on('click', () => {
                const cancelled = cancelAiRequest(state, 'cataloging', 'Cancelled.', false);
                if (cancelled) updateAiCatalogingStatus($panel, 'Cancelled.', 'warning');
            });
            $panel.find('#isbd-ai-panel-run').on('click', async function() {
                if (!isInternFeatureAllowed(state, 'aiPunctuation')) {
                    toast('warning', 'AI punctuation requests are disabled for this internship profile.');
                    return;
                }
                const $button = $(this);
                const selection = updateAiPanelSelection($panel, settings, state);
                const element = selection.element;
                const features = {
                    punctuation_explain: settings.aiPunctuationExplain && $panel.find('#isbd-ai-opt-punctuation').is(':checked'),
                    subject_guidance: false,
                    call_number_guidance: false
                };
                $button.prop('disabled', true);
                try {
                    await requestAiAssist(settings, state, {
                        element,
                        features,
                        onStatus: (message, type) => updateAiPanelStatus($panel, message, type)
                    });
                } finally {
                    $button.prop('disabled', false);
                }
            });
            $panel.find('#isbd-ai-run-cataloging').on('click', async function() {
                if (!isInternFeatureAllowed(state, 'aiCataloging')) {
                    toast('warning', 'AI cataloging requests are disabled for this internship profile.');
                    return;
                }
                const $button = $(this);
                const features = {
                    punctuation_explain: false,
                    subject_guidance: settings.aiSubjectGuidance && $panel.find('#isbd-ai-opt-subjects').is(':checked'),
                    call_number_guidance: settings.aiCallNumberGuidance && $panel.find('#isbd-ai-opt-classification').is(':checked')
                };
                $button.prop('disabled', true);
                try {
                    await requestAiCatalogingAssist(settings, state, {
                        features,
                        onStatus: (message, type) => updateAiCatalogingStatus($panel, message, type)
                    });
                } finally {
                    $button.prop('disabled', false);
                }
            });
            $panel.find('#isbd-ai-retry-authority').on('click', async function() {
                const $button = $(this);
                $button.prop('disabled', true);
                updateAiCatalogingStatus($panel, 'Retrying Library of Congress authority verification...', 'info');
                try {
                    await retryAiAuthorityVerification(settings, state);
                    updateAiCatalogingStatus($panel, 'Authority verification retry completed.', 'success');
                } finally {
                    $button.prop('disabled', false);
                }
            });
            $panel.find('#isbd-ai-panel-preview').on('click', function() {
                const selection = updateAiPanelSelection($panel, settings, state);
                const meta = selection.meta;
                if (!meta) {
                    toast('warning', 'Select a MARC field before previewing AI payload.');
                    return;
                }
                const fieldContext = buildFieldContext(meta.tag, meta.occurrence);
                if (!fieldContext) {
                    toast('warning', 'Unable to read field context for preview.');
                    return;
                }
                const recordContext = buildAiRecordContext(meta, settings, state);
                const features = {
                    punctuation_explain: settings.aiPunctuationExplain && $panel.find('#isbd-ai-opt-punctuation').is(':checked'),
                    subject_guidance: false,
                    call_number_guidance: false
                };
                const tagContext = {
                    ...fieldContext,
                    occurrence: normalizeOccurrence(fieldContext.occurrence),
                    active_subfield: meta.code
                };
                const payload = {
                    request_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    task: 'punctuation_explanation',
                    context_mode: normalizeAiContextMode(settings.aiContextMode),
                    tag_context: redactTagContext(tagContext, settings, state),
                    features
                };
                if (recordContext && recordContext.fields && recordContext.fields.length) {
                    payload.record_context = redactRecordContext(recordContext, settings, state);
                }
                showAiPreviewModal(payload);
            });
            $panel.find('#isbd-ai-cataloging-preview').on('click', function() {
                const titleInfo = getTitleWithSubtitle();
                if (!titleInfo.title) {
                    toast('warning', '245$a is required before previewing AI cataloging payload.');
                    return;
                }
                const fieldContext = buildFieldContext('245', titleInfo.occurrence || '');
                if (!fieldContext) {
                    toast('warning', 'Unable to read 245 context for preview.');
                    return;
                }
                const tagContext = buildCatalogingTagContext(fieldContext);
                if (!tagContext) {
                    toast('warning', 'Unable to build 245 title source for preview.');
                    return;
                }
                const features = {
                    punctuation_explain: false,
                    subject_guidance: settings.aiSubjectGuidance && $panel.find('#isbd-ai-opt-subjects').is(':checked'),
                    call_number_guidance: settings.aiCallNumberGuidance && $panel.find('#isbd-ai-opt-classification').is(':checked')
                };
                const payload = {
                    request_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    task: catalogingTaskFromFeatures(features),
                    context_mode: normalizeAiContextMode(settings.aiContextMode),
                    tag_context: redactTagContext(tagContext, settings, state),
                    features
                };
                const previewRecordContext = buildAiRecordContext(
                    { tag: '245', occurrence: titleInfo.occurrence || 0 }, settings, state );
                if (previewRecordContext && previewRecordContext.fields && previewRecordContext.fields.length) {
                    payload.record_context = redactRecordContext(previewRecordContext, settings, state);
                }
                showAiPreviewModal(payload);
            });
            $panel.find('#isbd-ai-classification-input').on('input', function() {
                updateAiCatalogingContext($panel, settings, state);
            });
            $panel.find('#isbd-ai-use-suggested-class').on('click', function() {
                if (!isInternFeatureAllowed(state, 'aiApplyActions') || (state && state.readOnly)) {
                    toast('warning', 'AI apply actions are disabled in internship mode.');
                    return;
                }
                const manualValue = ($panel.find('#isbd-ai-classification-input').val() || '').toString().trim();
                if (manualValue) {
                    updateAiCatalogingContext($panel, settings, state);
                    toast('info', 'Manual classification retained.');
                    return;
                }
                const suggested = state && state.aiSuggestions ? (state.aiSuggestions.classification || '') : '';
                if (!suggested) {
                    toast('info', 'No suggested classification is available yet.');
                    return;
                }
                $panel.find('#isbd-ai-classification-input').val(suggested);
                updateAiCatalogingContext($panel, settings, state);
                toast('info', 'Suggested classification applied.');
            });
            $panel.find('input[name="isbd-ai-prefix-type"]').on('change', function() {
                updateAiCatalogingContext($panel, settings, state);
            });
            $panel.find('#isbd-ai-opt-classification, #isbd-ai-opt-subjects').on('change', function() {
                updateAiCatalogingContext($panel, settings, state);
            });
            $panel.find('#isbd-ai-apply-callnumber').on('click', function() {
                if (!isInternFeatureAllowed(state, 'aiApplyActions') || (state && state.readOnly)) {
                    toast('warning', 'AI apply actions are disabled in internship mode.');
                    return;
                }
                const info = updateAiCatalogingContext($panel, settings, state);
                const inputValue = $panel.find('#isbd-ai-classification-input').val() || '';
                const suggestionValue = state && state.aiSuggestions ? state.aiSuggestions.classification || '' : '';
                const rangeMessage = classificationRangeMessage(inputValue) || classificationRangeMessage(suggestionValue);
                if (rangeMessage) {
                    toast('error', rangeMessage);
                    return;
                }
                if (!info.callNumber) {
                    toast('warning', 'Enter a classification number to build a call number.');
                    return;
                }
                const target = findCallNumberTarget();
                if (!target || !target.$field || !target.$field.length) {
                    toast('warning', 'No call number field (050$a/090$a) found on this form.');
                    return;
                }
                const targetMeta = parseFieldMeta(target.$field[0]) || { occurrence: '' };
                const targetCode = ((target && target.code) || 'a').toLowerCase();
                const classValue = (info.classSegment || '').trim();
                const cutterValue = (info.cutterSegment || '').trim();
                const rawClassValue = (info.classification || '').trim();
                const prefixValue = (info.prefix || '').trim();
                const $classField = (targetCode === 'a')
                    ? target.$field
                    : ensureSubfieldInput(target.tag, targetMeta.occurrence || '', targetCode);
                if (!$classField || !$classField.length) {
                    toast('warning', `Unable to locate ${target.tag}$${targetCode} on this form.`);
                    return;
                }
                const classMeta = parseFieldMeta($classField[0]) || { occurrence: targetMeta.occurrence || '' };
                const classTarget = { tag: target.tag, code: targetCode, occurrence: classMeta.occurrence || '' };
                setTargetSubfieldValueWithUndo($classField, classTarget, classValue, state);
                const $cutterField = ensureSubfieldInput(target.tag, targetMeta.occurrence || '', 'b');
                const hasCutterField = !!($cutterField && $cutterField.length);
                if (hasCutterField) {
                    const cutterMeta = parseFieldMeta($cutterField[0]) || { occurrence: targetMeta.occurrence || '' };
                    const cutterTarget = { tag: target.tag, code: 'b', occurrence: cutterMeta.occurrence || '' };
                    setTargetSubfieldValueWithUndo($cutterField, cutterTarget, cutterValue, state);
                }
                let mirror942Applied = false;
                if (apply942PartsEnabled($panel)) {
                    const occ942 = resolveTagOccurrence('942', ['c', 'a', 'h', 'i', 'k', 'm']);
                    const apply942Part = (code, value) => {
                        const $field942 = ensureSubfieldInputFlexible('942', occ942, code);
                        if (!$field942 || !$field942.length) return false;
                        const meta942 = parseFieldMeta($field942[0]) || { occurrence: occ942 };
                        return setTargetSubfieldValueWithUndo(
                            $field942,
                            { tag: '942', code, occurrence: meta942.occurrence || occ942 || '' },
                            value,
                            state
                        );
                    };
                    if (apply942Part('h', rawClassValue)) mirror942Applied = true;
                    if (apply942Part('i', cutterValue)) mirror942Applied = true;
                    if (apply942Part('k', prefixValue)) mirror942Applied = true;
                }
                storePendingItemCallNumber(info.callNumber || '');
                const hasCutter = !!info.cutter;
                let message = `Call number applied: ${target.tag}$${targetCode}="${classValue}"`;
                message += hasCutterField ? `, ${target.tag}$b="${cutterValue}".` : '.';
                if (!hasCutterField) {
                    message += ` Unable to locate/create ${target.tag}$b.`;
                } else if (!hasCutter) {
                    message += ' Cutter-Sanborn match not found; review the cutter.';
                }
                if (apply942PartsEnabled($panel)) {
                    message += mirror942Applied
                        ? ' Mirrored to 942$h/$i/$k.'
                        : ' 942 mirror selected, but no editable 942 field was found.';
                }
                toast((hasCutter && hasCutterField) ? 'info' : 'warning', message);
            });
            $panel.find('#isbd-ai-undo-callnumber').on('click', function() {
                undoLastChange();
                updateAiCatalogingContext($panel, settings, state);
            });
            $panel.find('#isbd-ai-redo-callnumber').on('click', function() {
                redoLastChange();
                updateAiCatalogingContext($panel, settings, state);
            });
            $panel.on('click', '.isbd-ai-subject-apply', function() {
                if (!isInternFeatureAllowed(state, 'aiApplyActions') || (state && state.readOnly)) {
                    toast('warning', 'AI apply actions are disabled in internship mode.');
                    return;
                }
                const index = Number($(this).attr('data-index'));
                applyAiSubjectByIndex(settings, state, index);
                updateAiCatalogingContext($panel, settings, state);
            });
            $panel.on('click', '.isbd-ai-subject-undo', function() {
                if (!isInternFeatureAllowed(state, 'aiApplyActions') || (state && state.readOnly)) {
                    toast('warning', 'AI apply actions are disabled in internship mode.');
                    return;
                }
                const index = Number($(this).attr('data-index'));
                if (undoAiSubjectApplyByIndex(settings, state, index)) {
                    updateAiCatalogingContext($panel, settings, state);
                }
            });
            $panel.on('click', '.isbd-ai-subject-redo', function() {
                if (!isInternFeatureAllowed(state, 'aiApplyActions') || (state && state.readOnly)) {
                    toast('warning', 'AI apply actions are disabled in internship mode.');
                    return;
                }
                const index = Number($(this).attr('data-index'));
                if (redoAiSubjectApplyByIndex(settings, state, index)) {
                    updateAiCatalogingContext($panel, settings, state);
                }
            });
            $panel.find('#isbd-ai-apply-selected').on('click', () => {
                applySelectedAiPatches(state);
            });
            $panel.find('#isbd-ai-apply-all').on('click', () => {
                applyAllAiPatches(state);
            });
        }
        const aiCatalogingAllowed = isInternFeatureAllowed(state, 'aiCataloging');
        const aiPunctuationAllowed = isInternFeatureAllowed(state, 'aiPunctuation');
        $panel.find('#isbd-ai-opt-punctuation')
            .prop('checked', !!(settings.aiPunctuationExplain && aiPunctuationAllowed))
            .prop('disabled', !settings.aiPunctuationExplain || !aiPunctuationAllowed);
        $panel.find('#isbd-ai-opt-classification')
            .prop('checked', !!(settings.aiCallNumberGuidance && aiCatalogingAllowed))
            .prop('disabled', !settings.aiCallNumberGuidance || !aiCatalogingAllowed);
        $panel.find('#isbd-ai-opt-subjects')
            .prop('checked', !!(settings.aiSubjectGuidance && aiCatalogingAllowed))
            .prop('disabled', !settings.aiSubjectGuidance || !aiCatalogingAllowed);
        updateAiPanelSelection($panel, settings, state);
        updateAiCatalogingContext($panel, settings, state);
        applyStoredAiStatus($panel, state);
        updateAiCancelButtonState(state);
        $panel.show();
        recoverFloatingPanel($panel, { minWidth: 320, minHeight: 220, right: 24, bottom: 24, buttonSelector: '#isbd-ai-panel-minimize' });
        if (state) state.aiPanelOpen = true;
        updateAiToggleButton();
    }

    function showAiPreviewModal(payload) {
        $('.isbd-ai-preview-modal, .isbd-guide-backdrop').remove();
        const json = JSON.stringify(payload, null, 2);
        const modal = $(`
            <div class="isbd-guide-backdrop"></div>
            <div class="isbd-ai-preview-modal">
                <h4 style="margin-top:0;">AI Payload Preview</h4>
                <p class="meta">This is the redacted JSON that will be sent to the AI provider.</p>
                <pre>${escapeAttr(json)}</pre>
                <div style="text-align: right;">
                    <button type="button" class="btn btn-xs btn-default" id="isbd-ai-preview-close">Close</button>
                </div>
            </div>
        `);
        $('body').append(modal);
        $('#isbd-ai-preview-close').on('click', () => {
            $('.isbd-ai-preview-modal, .isbd-guide-backdrop').remove();
        });
    }

    async function requestAiAssist(settings, state, options) {
        const opts = options || {};
        if (!isInternFeatureAllowed(state, 'aiPunctuation')) {
            const denied = 'AI punctuation requests are disabled for this internship profile.';
            toast('warning', denied);
            if (typeof opts.onStatus === 'function') opts.onStatus(denied, 'error');
            return;
        }
        const active = opts.element || resolveAiTargetElement(state);
        const meta = active ? parseFieldMeta(active) : null;
        const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : null;
        if (!meta) {
            const message = 'Select a MARC field before requesting rules and punctuation suggestions.';
            toast('warning', message);
            if (onStatus) onStatus(message, 'error');
            return;
        }
        if (isExcluded(settings, state, meta.tag, meta.code)) {
            const message = `AI assistance is disabled for excluded field ${meta.tag}$${meta.code}.`;
            toast('warning', message);
            if (onStatus) onStatus(`Error: ${message}`, 'error');
            return;
        }
        const fieldContext = buildFieldContext(meta.tag, meta.occurrence);
        if (!fieldContext) {
            const message = 'Unable to read field context.';
            toast('warning', message);
            if (onStatus) onStatus(`Error: ${message}`, 'error');
            return;
        }
        const tagContext = {
            ...fieldContext,
            occurrence: normalizeOccurrence(fieldContext.occurrence),
            active_subfield: meta.code
        };
        if (!global.ISBDRulesEngine.isFieldCovered(meta.tag, meta.code, fieldContext.ind1 || '', fieldContext.ind2 || '', state.rules)) {
            const message = 'No ISBD rule defined for this field; AI assistance disabled.';
            toast('warning', message);
            if (onStatus) onStatus(`Error: ${message}`, 'error');
            return;
        }
        const recordContext = buildAiRecordContext(meta, settings, state);
        const features = opts.features || {
            punctuation_explain: settings.aiPunctuationExplain,
            subject_guidance: settings.aiSubjectGuidance,
            call_number_guidance: settings.aiCallNumberGuidance
        };

        const payload = {
            request_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            task: 'punctuation_explanation',
            context_mode: normalizeAiContextMode(settings.aiContextMode),
            tag_context: tagContext,
            features
        };
        if (recordContext && recordContext.fields && recordContext.fields.length) {
            payload.record_context = recordContext;
        }
        const requestId = startAiRequest(state, 'punctuation');
        const signal = getAiRequestSignal(state, 'punctuation', requestId);
        const setStatus = (message, type) => {
            if (!isLatestAiRequest(state, 'punctuation', requestId)) return;
            setAiRequestStatus(state, 'punctuation', message, type);
            if (onStatus) onStatus(message, type);
        };
        const progress = startAiRequestProgress(state, 'punctuation', requestId, setStatus, 'Sending request');
        toast('info', 'Running rules and punctuation suggestions...');
        try {
            progress.setPhase('Waiting for AI response');
            const result = await global.ISBDApiClient.aiSuggest(settings.pluginPath, payload, { signal });
            if (!isLatestAiRequest(state, 'punctuation', requestId)) return;
            if (result.error) {
                progress.stop();
                const friendly = humanizeAiError(result.error, settings);
                toast('error', friendly);
                renderAiDebug($('#isbd-ai-panel'), 'punctuation', result);
                setStatus(`Error: ${friendly}`, 'error');
                return;
            }
            progress.setPhase('Parsing response');
            notifyTruncation(result);
            const mergedResult = mergeDeterministicPunctuationFallback(result, fieldContext, settings, state);
            renderAiPunctuationResults($('#isbd-ai-panel'), settings, state, meta, mergedResult);
            renderAiDebug($('#isbd-ai-panel'), 'punctuation', mergedResult);
            progress.stop();
            if (mergedResult.degraded_mode && mergedResult.extracted_call_number) {
                const message = `AI returned non-structured output; extracted LC candidate: ${mergedResult.extracted_call_number}.`;
                toast('warning', message);
                setStatus('Done', 'success');
            } else {
                toast('info', 'Rules & punctuation suggestions ready.');
                setStatus('Done', 'success');
            }
        } catch (err) {
            if (!isLatestAiRequest(state, 'punctuation', requestId)) return;
            if (isAbortError(err)) {
                progress.stop();
                const message = 'Cancelled.';
                setStatus(message, 'warning');
                return;
            }
            progress.stop();
            const message = `AI suggestions unavailable: ${humanizeAiError(err.message, settings)}`;
            toast('error', message);
            setStatus(`Error: ${humanizeAiError(err.message, settings)}`, 'error');
        } finally {
            progress.stop();
            if (isLatestAiRequest(state, 'punctuation', requestId)) {
                finishAiRequest(state, 'punctuation', requestId);
            }
        }
    }

    function normalizeAiContextMode(mode) {
        if (mode === 'tag_plus_neighbors') return 'tag_plus_related_fields';
        if (mode === 'full') return 'full_record';
        return ['tag_only', 'tag_plus_related_fields', 'full_record'].includes(mode) ? mode : 'tag_only';
    }

    function catalogingTaskFromFeatures(features) {
        const classification = !!(features && features.call_number_guidance);
        const subjects = !!(features && features.subject_guidance);
        if (classification && subjects) return 'cataloging_review';
        if (subjects) return 'subject_heading_suggestion';
        return 'cataloging_classification';
    }

    function catalogingToastState(result, classification, subjects) {
        const hasSuggestions = !!classification || (Array.isArray(subjects) && subjects.length > 0);
        const parseStatus = (result && result.ai_parse_status) || '';
        const authorityStatus = (result && result.authority_lookup_status) || '';
        if (parseStatus === 'degraded_recovery' && hasSuggestions) {
            return { type: 'warning', message: 'Cataloguing suggestions were recovered from non-structured AI output. Review them carefully before applying.' };
        }
        if (hasSuggestions && (authorityStatus === 'service_unavailable' || authorityStatus === 'invalid_authority_response')) {
            return { type: 'warning', message: 'AI suggestions are available, but authority verification is temporarily unavailable.' };
        }
        if (parseStatus === 'truncated' || (result && result.status === 'incomplete')) {
            return { type: 'warning', message: 'The AI response was incomplete; no unsafe cataloguing suggestion was accepted.' };
        }
        if (parseStatus === 'malformed') {
            return { type: 'warning', message: 'The AI response could not be safely parsed into cataloguing suggestions.' };
        }
        if (!hasSuggestions) {
            return { type: 'info', message: 'AI could not produce a safe cataloguing suggestion from the available evidence.' };
        }
        return { type: 'success', message: 'Cataloguing suggestions ready.' };
    }

    async function requestAiCatalogingAssist(settings, state, options) {
        const opts = options || {};
        const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : null;
        if (!internFeatureAllowed(state, 'aiCataloging')) {
            const message = 'AI cataloging requests are disabled for this internship profile.';
            toast('warning', message);
            if (onStatus) onStatus(`Error: ${message}`, 'error');
            return;
        }
        const titleInfo = getTitleWithSubtitle();
        if (!titleInfo.title) {
            const message = '245$a is required for AI cataloging guidance.';
            toast('warning', message);
            if (onStatus) onStatus(`Error: ${message}`, 'error');
            return;
        }
        if (isExcluded(settings, state, '245', 'a')) {
            const message = 'AI cataloging guidance is disabled because 245$a is excluded.';
            toast('warning', message);
            if (onStatus) onStatus(`Error: ${message}`, 'error');
            return;
        }
        const fieldContext = buildFieldContext('245', titleInfo.occurrence || '');
        if (!fieldContext) {
            const message = 'Unable to read 245 context.';
            toast('warning', message);
            if (onStatus) onStatus(`Error: ${message}`, 'error');
            return;
        }
        const tagContext = buildCatalogingTagContext(fieldContext);
        if (!tagContext || !tagContext.subfields || !tagContext.subfields.length) {
            const message = '245$a is required for AI cataloging guidance.';
            toast('warning', message);
            if (onStatus) onStatus(`Error: ${message}`, 'error');
            return;
        }
        const features = opts.features || {
            punctuation_explain: false,
            subject_guidance: settings.aiSubjectGuidance,
            call_number_guidance: settings.aiCallNumberGuidance
        };
        if (!features.subject_guidance && !features.call_number_guidance) {
            const message = 'Select at least one AI cataloging option.';
            toast('warning', message);
            if (onStatus) onStatus(`Error: ${message}`, 'error');
            return;
        }
        const payload = {
            request_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            task: catalogingTaskFromFeatures(features),
            context_mode: normalizeAiContextMode(settings.aiContextMode),
            tag_context: tagContext,
            features
        };
        const catalogingRecordContext = buildAiRecordContext(
            { tag: '245', occurrence: titleInfo.occurrence || 0 }, settings, state );
        if (catalogingRecordContext && catalogingRecordContext.fields && catalogingRecordContext.fields.length) {
            payload.record_context = catalogingRecordContext;
        }
        const requestId = startAiRequest(state, 'cataloging');
        const signal = getAiRequestSignal(state, 'cataloging', requestId);
        const setStatus = (message, type) => {
            if (!isLatestAiRequest(state, 'cataloging', requestId)) return;
            setAiRequestStatus(state, 'cataloging', message, type);
            if (onStatus) onStatus(message, type);
        };
        const progress = startAiRequestProgress(state, 'cataloging', requestId, setStatus, 'Sending request');
        toast('info', 'Running cataloging suggestions...');
        try {
            progress.setPhase('Waiting for AI response');
            const result = await global.ISBDApiClient.aiSuggest(settings.pluginPath, payload, { signal });
            if (!isLatestAiRequest(state, 'cataloging', requestId)) return;
            if (result.error) {
                progress.stop();
                const friendly = humanizeAiError(result.error, settings);
                toast('error', friendly);
                renderAiDebug($('#isbd-ai-panel'), 'cataloging', result);
                setStatus(`Error: ${friendly}`, 'error');
                return;
            }
            progress.setPhase('Parsing response');
            notifyTruncation(result);
            const findings = Array.isArray(result.findings) ? result.findings : [];
            const assistantMessage = pickAiAssistantText(result, findings);
            const resultSubjects = Array.isArray(result.subjects) ? result.subjects : [];
            const rawSubjects = resultSubjects;
            let classification = (result.classification || '').toString().trim();
            classification = sanitizeAiClassificationSuggestion(classification || '');
            let subjects = normalizeSubjectObjects(rawSubjects || []);
            const errors = Array.isArray(result.errors) ? result.errors.slice() : [];
            const rangeMessage = classificationRangeMessage(classification || '');
            if (rangeMessage) {
                classification = '';
                if (!errors.find(err => err && err.code === 'CLASSIFICATION_RANGE')) {
                    errors.push({ code: 'CLASSIFICATION_RANGE', field: 'classification', message: rangeMessage });
                }
            }
            const candidate = result.candidate || result.classification_candidate || null;
            const confidence = candidate && typeof candidate.confidence === 'string'
                ? candidate.confidence
                : (result.status === 'insufficient_evidence' ? 'insufficient evidence' : 'low');
            state.aiSuggestions = {
                classification,
                subjects,
                confidence,
                rationale: result.rationale && typeof result.rationale === 'object'
                    ? result.rationale
                    : { ai: formatCatalogingAssistantText(assistantMessage || ''), system: '' },
                errors,
                authorityStatus: result.authority_status || (candidate && candidate.authority_status) || 'unverified',
                evidenceVerification: result.evidence_verification && typeof result.evidence_verification === 'object'
                    ? result.evidence_verification
                    : null,
                requiresHumanReview: result.requires_human_review !== false,
                status: result.status || '',
                parseStatus: result.ai_parse_status || '',
                authorityLookupStatus: result.authority_lookup_status || ''
            };
            state.aiSubjectHistory = {};
            const $panel = $('#isbd-ai-panel');
            const $classInput = $panel.find('#isbd-ai-classification-input');
            if ($classInput.length && classification && !String($classInput.val() || '').trim()) {
                $classInput.val(classification);
            }
            updateAiCatalogingContext($panel, settings, state);
            renderAiDebug($('#isbd-ai-panel'), 'cataloging', result);
            progress.stop();
            const toastState = catalogingToastState(result, classification, subjects);
            toast(toastState.type, toastState.message);
            setStatus('Done', classification || subjects.length ? 'success' : 'info');
        } catch (err) {
            if (!isLatestAiRequest(state, 'cataloging', requestId)) return;
            if (isAbortError(err)) {
                progress.stop();
                const message = 'Cancelled.';
                setStatus(message, 'warning');
                return;
            }
            progress.stop();
            const message = `AI cataloging suggestions unavailable: ${humanizeAiError(err.message, settings)}`;
            toast('error', message);
            setStatus(`Error: ${humanizeAiError(err.message, settings)}`, 'error');
        } finally {
            progress.stop();
            if (isLatestAiRequest(state, 'cataloging', requestId)) {
                finishAiRequest(state, 'cataloging', requestId);
            }
        }
    }

    async function retryAiAuthorityVerification(settings, state) {
        const subjects = normalizeSubjectObjects(
            state && state.aiSuggestions ? state.aiSuggestions.subjects || [] : []
        );
        if (!subjects.length) {
            toast('info', 'No subject suggestions are available for authority verification.');
            return;
        }
        try {
            const result = await global.ISBDApiClient.retryAuthority(settings.pluginPath, {
                request_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                candidates: subjects
            });
            const verifiedSubjects = normalizeSubjectObjects(result.subjects || []);
            state.aiSuggestions.subjects = verifiedSubjects;
            state.aiSuggestions.authorityLookupStatus = result.authority_lookup_status || '';
            if (result.rationale && typeof result.rationale === 'object') {
                state.aiSuggestions.rationale = result.rationale;
            }
            updateAiCatalogingContext($('#isbd-ai-panel'), settings, state);
            renderAiDebug($('#isbd-ai-panel'), 'cataloging', result);
            const unavailable = result.authority_lookup_status === 'service_unavailable'
                || result.authority_lookup_status === 'invalid_authority_response';
            toast(unavailable ? 'warning' : 'success', unavailable
                ? 'Authority verification is still unavailable; AI suggestions were preserved.'
                : 'Authority verification refreshed without regenerating AI suggestions.');
        } catch (err) {
            toast('error', `Authority verification retry failed: ${humanizeAiError(err.message, settings)}`);
            throw err;
        }
    }

    function aiPatchCount(findings) {
        if (!Array.isArray(findings)) return 0;
        let count = 0;
        findings.forEach(finding => {
            const fixes = Array.isArray(finding && finding.proposed_fixes) ? finding.proposed_fixes : [];
            fixes.forEach(fix => {
                const patchList = Array.isArray(fix && fix.patch) ? fix.patch : [];
                patchList.forEach(patch => {
                    if (patch && patch.op === 'replace_subfield') count += 1;
                });
            });
        });
        return count;
    }

    function convertDeterministicFindingToAiFinding(finding) {
        if (!finding || typeof finding !== 'object') return null;
        const ruleFix = finding.proposed_fixes && finding.proposed_fixes[0] && finding.proposed_fixes[0].patch && finding.proposed_fixes[0].patch[0];
        const occurrence = normalizeOccurrence(finding.occurrence);
        const patch = (ruleFix && ruleFix.op === 'replace_subfield')
            ? {
                op: 'replace_subfield',
                tag: ruleFix.tag || finding.tag || '',
                subfield: ruleFix.code || finding.subfield || '',
                occurrence,
                original_text: finding.current_value || '',
                replacement_text: (ruleFix.value !== undefined && ruleFix.value !== null)
                    ? String(ruleFix.value)
                    : String(finding.expected_value || '')
            }
            : null;
        return {
            severity: finding.severity || 'INFO',
            code: finding.code || 'ISBD_RULE',
            message: finding.message || '',
            rationale: finding.rationale || '',
            tag: finding.tag || '',
            subfield: finding.subfield || '',
            occurrence,
            current_value: finding.current_value || '',
            expected_value: finding.expected_value || '',
            confidence: 1,
            proposed_fixes: patch ? [{ label: 'Apply ISBD punctuation', patch: [patch] }] : []
        };
    }

    function deterministicPunctuationFindings(fieldContext, settings, state) {
        if (!fieldContext || !global.ISBDRulesEngine || typeof global.ISBDRulesEngine.validateField !== 'function') return [];
        const rules = (state && Array.isArray(state.rules)) ? state.rules : [];
        if (!rules.length) return [];
        const result = global.ISBDRulesEngine.validateField(fieldContext, settings, rules);
        const localFindings = Array.isArray(result && result.findings) ? result.findings : [];
        return localFindings
            .map(convertDeterministicFindingToAiFinding)
            .filter(Boolean);
    }

    function mergeDeterministicPunctuationFallback(result, fieldContext, settings, state) {
        const merged = (result && typeof result === 'object') ? { ...result } : {};
        const aiFindings = Array.isArray(merged.findings) ? merged.findings.slice() : [];
        const deterministicFindings = deterministicPunctuationFindings(fieldContext, settings, state);
        if (!deterministicFindings.length) {
            merged.findings = aiFindings;
            merged.issues = Array.isArray(merged.issues) ? merged.issues : [];
            return merged;
        }
        const assistant = (merged.assistant_message || '').toString().trim();
        const noChangeText = /^no punctuation change needed\.?$/i.test(assistant);
        const needsAugment = noChangeText || !aiFindings.length || aiPatchCount(aiFindings) === 0;
        if (!needsAugment) {
            merged.findings = aiFindings;
            merged.issues = Array.isArray(merged.issues) ? merged.issues : [];
            return merged;
        }
        const dedupe = new Set();
        const combined = [];
        aiFindings.concat(deterministicFindings).forEach(finding => {
            if (!finding) return;
            const key = [
                finding.code || '',
                finding.tag || '',
                finding.subfield || '',
                normalizeOccurrence(finding.occurrence),
                finding.current_value || '',
                finding.expected_value || '',
                finding.message || ''
            ].join('|');
            if (dedupe.has(key)) return;
            dedupe.add(key);
            combined.push(finding);
        });
        merged.findings = combined;
        merged.issues = Array.isArray(merged.issues) ? merged.issues : [];
        if (noChangeText || !assistant) {
            merged.assistant_message = 'Deterministic ISBD checks found punctuation updates.';
        }
        return merged;
    }

    function startAiRequestProgress(state, context, requestId, setStatus, initialPhase) {
        const startedAt = Date.now();
        let phase = initialPhase || 'Running';
        let stopped = false;
        let slowInfoShown = false;
        let slowWarningShown = false;
        const normalizePhase = value => (value || '').toString().trim().toLowerCase();
        const isWaitingPhase = () => normalizePhase(phase).includes('waiting for ai response');
        const phaseHint = elapsed => {
            if (!isWaitingPhase()) {
                if (elapsed >= 8) return 'finalizing output';
                return '';
            }
            if (elapsed >= 70) return 'still waiting; provider queue may be congested';
            if (elapsed >= 50) return 'still waiting; provider is still processing';
            if (elapsed >= 30) return 'model is still generating output';
            if (elapsed >= 15) return 'provider is still preparing output';
            return '';
        };
        const maybeNotifySlowWait = elapsed => {
            if (!isWaitingPhase()) return;
            if (!slowInfoShown && elapsed >= 20) {
                slowInfoShown = true;
                toast('info', 'AI response is taking longer than usual. Continuing to wait for provider output.');
            }
            if (!slowWarningShown && elapsed >= 65) {
                slowWarningShown = true;
                toast('warning', 'AI response is still pending. Provider queues may be busy.');
            }
        };
        const format = () => {
            const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
            const hint = phaseHint(elapsed);
            if (hint) return `${phase}... ${elapsed}s (${hint})`;
            return `${phase}... ${elapsed}s`;
        };
        const tick = () => {
            if (stopped) return;
            if (!isLatestAiRequest(state, context, requestId)) {
                stopped = true;
                return;
            }
            const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
            maybeNotifySlowWait(elapsed);
            setStatus(format(), 'info');
        };
        tick();
        const timer = setInterval(tick, 1000);
        return {
            setPhase(nextPhase) {
                if (!nextPhase) return;
                phase = nextPhase;
                tick();
            },
            stop() {
                if (stopped) return;
                stopped = true;
                clearInterval(timer);
            }
        };
    }

    function humanizeAiError(message, settings) {
        const raw = (message || '').toString().trim();
        const lower = raw.toLowerCase();
        if (!raw) return 'AI request failed.';
        if (lower.includes('429') || lower.includes('rate limit')) {
            return `${raw} Try again in 30-60 seconds, reduce request frequency, or switch model/account quota.`;
        }
        if (lower.includes('response was empty')) {
            return `${raw} Retry once. If it repeats, lower reasoning effort or max output tokens.`;
        }
        if (lower.includes('circuit breaker')) {
            return `${raw} Wait for the cooldown period, then retry.`;
        }
        return raw;
    }

    function summarizeAiFindings(findings) {
        if (!Array.isArray(findings) || !findings.length) return '';
        return findings.map(finding => {
            const message = (finding.message || '').toString().trim();
            const rationale = (finding.rationale || '').toString().trim();
            if (message && rationale && rationale !== message) return `${message} - ${rationale}`;
            return message || rationale || '';
        }).filter(Boolean).join('\n');
    }

    function pickAiAssistantText(result, findings) {
        if (result && result.assistant_message) {
            const text = String(result.assistant_message).trim();
            if (text && !/^```/.test(text) && !/^[\\[{]/.test(text)) return text;
        }
        const summary = summarizeAiFindings(findings);
        if (summary) return summary;
        if (result && result.raw_text_excerpt) return String(result.raw_text_excerpt).trim();
        return '';
    }

    function normalizeClassificationSuggestion(text) {
        const cleaned = (text || '')
            .toString()
            .trim()
            .replace(/\s{2,}/g, ' ')
            .replace(/\s*\(fallback[^)]*\)\s*$/i, '')
            .replace(/[\s\.,;:]+$/g, '')
            .trim();
        return cleaned;
    }

    function normalizeLcClassForCallNumber(value) {
        const text = (value || '').toString().trim();
        if (!text) return '';
        const match = text.match(/^([A-Z]{1,3})\s*(\d{1,4}(?:\s*\.\s*\d+)?)/i);
        if (!match) return text.replace(/\s{2,}/g, ' ');
        const cls = (match[1] || '').toUpperCase();
        const number = (match[2] || '')
            .replace(/\s*\.\s*/g, '.')
            .replace(/\s+/g, '');
        return cls && number ? `${cls}${number}` : text.replace(/\s{2,}/g, ' ');
    }

    function sanitizeAiClassificationSuggestion(text) {
        const cleaned = normalizeClassificationSuggestion(text);
        if (!cleaned) return '';
        if (/^\d{3}\s*\$[a-z0-9]/i.test(cleaned)) return '';
        if (/^(AND|ARE|BUT|CAN|FOR|FROM|HAD|HAS|HAVE|HER|HIS|ITS|MAY|NOT|OUR|THE|THIS|THAT|TOO|WAS|WERE|WHO|YOU)\s+\d{1,4}(?:\.\d+)?$/i.test(cleaned)) {
            return '';
        }
        const extract = global.ISBDAiTextExtract;
        if (extract && typeof extract.extractLcCallNumbers === 'function') {
            const matches = extract.extractLcCallNumbers(cleaned);
            if (!matches.length) return '';
            return (matches[0] || '').toString().trim();
        }
        return cleaned;
    }

    function formatCatalogingAssistantText(text) {
        const raw = (text || '')
            .toString()
            .replace(/\r\n?/g, '\n')
            .trim();
        if (!raw) return '';
        const sectionPattern = /^\s*(classification|subjects|confidence|rationale)\s*:/i;
        const lines = raw.split('\n');
        const hasSectionedFormat = lines.some(line => sectionPattern.test(line || ''));
        if (!hasSectionedFormat) return raw;
        const output = [];
        lines.forEach(line => {
            const cleanedLine = (line || '').replace(/\s+$/g, '');
            if (sectionPattern.test(cleanedLine) && output.length && output[output.length - 1] !== '') {
                output.push('');
            }
            output.push(cleanedLine);
        });
        return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    function classificationRangeMessage(value) {
        const text = (value || '').toString();
        if (!text.trim()) return '';
        const normalized = text.replace(/[\u2012\u2013\u2014\u2212]/g, '-').trim();
        if (/^[A-Z]{1,3}\s*\d{1,4}(?:\s*\.\s*\d+)?\s*-\s*(?:[A-Z]{1,3}\s*)?\d{1,4}(?:\s*\.\s*\d+)?$/i.test(normalized)) {
            return 'Classification ranges are not allowed. Provide a single class number.';
        }
        if (/^\d{1,4}(?:\s*\.\s*\d+)?\s*-\s*\d{1,4}(?:\s*\.\s*\d+)?$/.test(normalized)) {
            return 'Classification ranges are not allowed. Provide a single class number.';
        }
        return '';
    }

    function normalizeSubjectHeading(text) {
        let value = (text || '').toString().trim();
        if (!value) return '';
        value = value.replace(/\s*--\s*/g, ' -- ');
        value = value.replace(/\s{2,}/g, ' ');
        value = value.replace(/\s*--\s*$/g, '').trim();
        return value;
    }

    function dedupeCaseInsensitive(items) {
        const seen = new Set();
        return items.filter(item => {
            const key = item.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function normalizeSubjectObjects(subjects) {
        const extract = global.ISBDAiTextExtract;
        if (extract && typeof extract.subjectsFromHeadingList === 'function') {
            const normalized = extract.subjectsFromHeadingList(subjects || []);
            return normalized.map((subject, index) => ({
                ...subject,
                authority_status: (subjects[index] && subjects[index].authority_status) || 'unverified',
                authority: (subjects[index] && subjects[index].authority) || null,
                rationale: (subjects[index] && subjects[index].rationale) || { ai: '', evidence: [] },
                heading: (subjects[index] && subjects[index].heading) || (subject.subfields && subject.subfields.a) || '',
                subdivisions: (subjects[index] && subjects[index].subdivisions) || [],
                confidence: (subjects[index] && subjects[index].confidence) || 'low'
            }));
        }
        if (!Array.isArray(subjects)) return [];
        return subjects.map(item => {
            if (item && typeof item === 'object') return item;
            const heading = normalizeSubjectHeading(item);
            if (!heading) return null;
            const parts = heading.split(/\s--\s/).map(part => part.trim()).filter(Boolean);
            if (!parts.length) return null;
            return {
                tag: '650',
                ind1: ' ',
                ind2: '0',
                subfields: {
                    a: parts[0],
                    x: parts.slice(1),
                    y: [],
                    z: [],
                    v: []
                }
            };
        }).filter(Boolean);
    }

    function renderAiSubjectList($panel, subjects) {
        const $list = $panel.find('#isbd-ai-subjects');
        if (!$list.length) return;
        if (!Array.isArray(subjects) || !subjects.length) {
            $list.text('No safe subject suggestion was produced.');
            return;
        }
        const state = global.ISBDIntellisenseState || {};
        const history = (state && state.aiSubjectHistory && typeof state.aiSubjectHistory === 'object')
            ? state.aiSubjectHistory
            : {};
        const formatter = global.ISBDAiTextExtract && typeof global.ISBDAiTextExtract.formatSubjectDisplay === 'function'
            ? global.ISBDAiTextExtract.formatSubjectDisplay
            : null;
        const readOnly = !!(global.ISBDIntellisenseState && global.ISBDIntellisenseState.readOnly);
        const allowAiApplyActions = internFeatureAllowed(global.ISBDIntellisenseState, 'aiApplyActions');
        const rows = subjects.map((item, index) => {
            let label = '';
            if (formatter) {
                label = formatter(item) || '';
            } else if (typeof item === 'string') {
                label = item;
            } else {
                const tag = item && item.tag ? item.tag : '650';
                const ind1 = item && item.ind1 !== undefined ? item.ind1 : ' ';
                const ind2 = item && item.ind2 !== undefined ? item.ind2 : '0';
                const sub = item && item.subfields ? item.subfields : {};
                const parts = [sub.a || ''];
                ['x', 'y', 'z', 'v'].forEach(code => {
                    const values = Array.isArray(sub[code]) ? sub[code] : [];
                    values.forEach(val => { if (val) parts.push(val); });
                });
                label = `${tag}${ind1}${ind2} ${parts.join(' -- ')}`.trim();
            }
            label = (label || '').trim();
            if (!label) return '';
            const authority = item && item.authority && typeof item.authority === 'object'
                ? item.authority
                : { status: 'unverified', match_type: 'no_match' };
            let authorityLabel = 'No LCSH authority match found';
            if (authority.match_type === 'exact_authorized' && authority.status === 'verified') authorityLabel = 'LCSH verified';
            else if (authority.match_type === 'variant_match') authorityLabel = 'Authorized heading found';
            else if (authority.match_type === 'close_candidate') authorityLabel = 'Possible authority match';
            else if (authority.status === 'service_unavailable') authorityLabel = 'Authority verification unavailable';
            else if (authority.status === 'invalid_authority_response') authorityLabel = 'Authority response invalid';
            else if (authority.status === 'unverified' && !authority.checked) authorityLabel = 'Not authority verified';
            const authorizedHeading = authority.match_type === 'variant_match' && authority.authorized_heading
                ? `<div class="meta"><strong>Authorized LCSH:</strong> ${escapeAttr(authority.authorized_heading)}</div>`
                : '';
            const authorityUri = /^https:\/\/id\.loc\.gov\/authorities\/subjects\/sh\d+$/i.test(authority.uri || '')
                ? `<a href="${escapeAttr(authority.uri)}" target="_blank" rel="noopener noreferrer">Open authority record</a>`
                : '';
            const evidenceParts = [];
            if (Array.isArray(authority.variants) && authority.variants.length) evidenceParts.push(`Variants: ${authority.variants.slice(0, 4).join('; ')}`);
            if (Array.isArray(authority.broader) && authority.broader.length) evidenceParts.push(`Broader: ${authority.broader.slice(0, 4).join('; ')}`);
            if (Array.isArray(authority.related) && authority.related.length) evidenceParts.push(`Related: ${authority.related.slice(0, 4).join('; ')}`);
            const authorityEvidence = evidenceParts.length
                ? `<details><summary>Authority evidence</summary><div class="meta">${escapeAttr(evidenceParts.join('\n')).replace(/\n/g, '<br>')}</div></details>`
                : '';
            const rationale = item && item.rationale && typeof item.rationale === 'object'
                ? (item.rationale.ai || '')
                : '';
            const rationaleHtml = rationale
                ? `<div class="meta"><strong>AI rationale:</strong> ${escapeAttr(rationale)}</div>`
                : '<div class="meta"><strong>System note:</strong> The AI did not provide a sufficient rationale for this candidate.</div>';
            const entry = history[index] || {};
            const showHistoryButtons = Array.isArray(entry.undoChanges) || Array.isArray(entry.redoChanges);
            const canUndo = !!(Array.isArray(entry.undoChanges) && entry.undoChanges.length);
            const canRedo = !!(Array.isArray(entry.redoChanges) && entry.redoChanges.length);
            return `
                <div class="isbd-ai-subject-row">
                    <span class="isbd-ai-subject-label">${escapeAttr(label)} <small>AI suggestion · ${authorityLabel} · Review required</small>${authorizedHeading}${rationaleHtml}${authorityEvidence}${authorityUri ? `<div class="meta">${authorityUri}</div>` : ''}</span>
                    <button type="button" class="btn btn-xs btn-primary isbd-ai-subject-apply" data-index="${index}" ${(readOnly || !allowAiApplyActions) ? 'disabled' : ''}>${authority.match_type === 'variant_match' ? 'Use authorized heading' : 'Apply'}</button>
                    ${showHistoryButtons ? `<button type="button" class="btn btn-xs isbd-btn-yellow isbd-ai-subject-undo" data-index="${index}" ${(readOnly || !allowAiApplyActions || !canUndo) ? 'disabled' : ''}>Undo</button>` : ''}
                    ${showHistoryButtons ? `<button type="button" class="btn btn-xs isbd-btn-yellow isbd-ai-subject-redo" data-index="${index}" ${(readOnly || !allowAiApplyActions || !canRedo) ? 'disabled' : ''}>Redo</button>` : ''}
                </div>
            `;
        }).filter(Boolean);
        $list.html(rows.join(''));
    }

    function cloneSubjectChanges(changes) {
        if (!Array.isArray(changes)) return [];
        return changes.map(change => ({ ...change }));
    }

    function applySubjectChangeList(changes, direction, state) {
        if (!Array.isArray(changes) || !changes.length) return false;
        const ordered = direction === 'previous' ? changes.slice().reverse() : changes.slice();
        let changed = false;
        ordered.forEach(change => {
            if (!change) return;
            const value = direction === 'previous' ? change.previous : change.next;
            if ((change.kind || 'subfield') === 'indicator') {
                if (setIndicatorValue(change.tag, change.indicator, change.occurrence, value || '')) {
                    changed = true;
                }
                return;
            }
            const $field = findFieldElement(change.tag, change.code, change.occurrence);
            if (!$field.length) return;
            const current = ($field.val() || '').toString();
            const next = (value || '').toString();
            if (current === next) return;
            $field.val(next);
            $field.trigger('change');
            markFieldForRevalidation(state, { tag: change.tag, code: change.code, occurrence: change.occurrence || '' });
            changed = true;
        });
        return changed;
    }

    function maybeShowAiGhost(element, findings, settings) {
        const state = global.ISBDIntellisenseState;
        if (state && state.readOnly) return;
        const meta = parseFieldMeta(element);
        if (!meta) return;
        const occurrenceKey = normalizeOccurrenceKey(meta.occurrence);
        const candidate = (findings || []).find(f => {
            if (!f) return false;
            if ((f.severity || '').toUpperCase() === 'ERROR') return false;
            if (!f.proposed_fixes || !f.proposed_fixes[0] || !f.proposed_fixes[0].patch || !f.proposed_fixes[0].patch[0]) return false;
            if ((f.tag || '') !== meta.tag) return false;
            if ((f.subfield || '').toLowerCase() !== (meta.code || '').toLowerCase()) return false;
            if (normalizeOccurrenceKey(f.occurrence || '') !== occurrenceKey) return false;
            return Number(f.confidence || 0) >= Number(settings.aiConfidenceThreshold || 0);
        });
        if (!candidate) return;
        const patch = candidate.proposed_fixes && candidate.proposed_fixes[0] && candidate.proposed_fixes[0].patch[0];
        if (!patch) return;
        const current = $(element).val() || '';
        const ghostText = computeGhostText(current, patch.replacement_text || '');
        if (!ghostText) return;
        const $ghost = $(`<span class="isbd-ghost-text" title="Accept AI suggestion">${ghostText}</span>`);
        $ghost.data('expected', patch.replacement_text || '');
        $ghost.on('click', () => {
            $(element).val(patch.replacement_text || '');
            $ghost.remove();
            markFieldForRevalidation(state, parseFieldMeta(element));
            toast('info', 'AI ghost suggestion applied.');
        });
        $(element).after($ghost);
    }

    function isSameOccurrence(a, b) {
        if (b === undefined || b === null || b === '') return true;
        if (a === undefined || a === null || a === '') return false;
        return normalizeOccurrenceKey(a) === normalizeOccurrenceKey(b);
    }

    function findFieldElement(tag, code, occurrence, subfieldIndex) {
        const normalizedTag = normalizeTag(tag);
        const normalizedCode = normalizeSubfieldCode(code);
        if (!isValidTag(normalizedTag) || !isValidSubfieldCode(normalizedCode)) return $();
        const selector = subfieldCodeVariants(normalizedCode).map(variant => {
            return `#subfield${normalizedTag}${variant}, input[id^="tag_${normalizedTag}_subfield_${variant}"], textarea[id^="tag_${normalizedTag}_subfield_${variant}"], select[id^="tag_${normalizedTag}_subfield_${variant}"], #tag_${normalizedTag}_subfield_${variant}, input[name^="field_${normalizedTag}${variant}"], textarea[name^="field_${normalizedTag}${variant}"], select[name^="field_${normalizedTag}${variant}"]`;
        }).join(', ');
        const $candidates = $(selector);
        if (occurrence === undefined || occurrence === null || occurrence === '') return $candidates.first();
        const scoped = $candidates.filter(function() {
            const meta = parseFieldMeta(this);
            return meta
                && meta.tag === normalizedTag
                && normalizeSubfieldCode(meta.code) === normalizedCode
                && isSameOccurrence(meta.occurrence, occurrence);
        });
        if (subfieldIndex !== undefined && subfieldIndex !== null && subfieldIndex !== '') {
            const fieldContext = buildFieldContext(normalizedTag, occurrence);
            let codeOrdinal = -1;
            if (fieldContext && Array.isArray(fieldContext.subfields)) {
                for (let i = 0; i < fieldContext.subfields.length; i++) {
                    const sub = fieldContext.subfields[i];
                    if (sub && normalizeSubfieldCode(sub.code) === normalizedCode) codeOrdinal++;
                    if (i === Number(subfieldIndex)) break;
                }
            }
            if (codeOrdinal >= 0 && scoped.eq(codeOrdinal).length) return scoped.eq(codeOrdinal);
        }
        const match = scoped.first();
        return match.length ? match : $candidates.first();
    }

    function collectSubfieldElements(tag, code, occurrence) {
        const normalizedTag = normalizeTag(tag);
        const normalizedCode = normalizeSubfieldCode(code);
        if (!isValidTag(normalizedTag) || !isValidSubfieldCode(normalizedCode)) return $();
        const selector = subfieldCodeVariants(normalizedCode).map(variant => {
            return `#subfield${normalizedTag}${variant}, input[id^="tag_${normalizedTag}_subfield_${variant}"], textarea[id^="tag_${normalizedTag}_subfield_${variant}"], select[id^="tag_${normalizedTag}_subfield_${variant}"], #tag_${normalizedTag}_subfield_${variant}, input[name^="field_${normalizedTag}${variant}"], textarea[name^="field_${normalizedTag}${variant}"], select[name^="field_${normalizedTag}${variant}"]`;
        }).join(', ');
        const matches = [];
        $(selector).each(function() {
            const meta = parseFieldMeta(this);
            if (!meta || meta.tag !== normalizedTag || normalizeSubfieldCode(meta.code) !== normalizedCode) return;
            if (!isSameOccurrence(meta.occurrence, occurrence)) return;
            matches.push(this);
        });
        return $(matches);
    }

    function setIndicatorValue(tag, indicator, occurrence, value) {
        const selector = [
            `input[id^="tag_${tag}_indicator${indicator}"]`,
            `select[id^="tag_${tag}_indicator${indicator}"]`,
            `input[name^="tag_${tag}_indicator${indicator}"]`,
            `select[name^="tag_${tag}_indicator${indicator}"]`
        ].join(',');
        let updated = false;
        $(selector).each(function() {
            const meta = parseIndicatorMeta(this);
            if (!meta || meta.tag !== tag) return;
            if (!isSameOccurrence(meta.occurrence, occurrence)) return;
            $(this).val(value);
            updated = true;
            return false;
        });
        return updated;
    }

    function findIndicatorElement(tag, indicator, occurrence) {
        const selector = [
            `input[id^="tag_${tag}_indicator${indicator}"]`,
            `select[id^="tag_${tag}_indicator${indicator}"]`,
            `input[name^="tag_${tag}_indicator${indicator}"]`,
            `select[name^="tag_${tag}_indicator${indicator}"]`
        ].join(',');
        return $(selector).filter(function() {
            const meta = parseIndicatorMeta(this);
            return meta && meta.tag === tag && isSameOccurrence(meta.occurrence, occurrence);
        }).first();
    }

    function setIndicatorValueWithUndo(tag, indicator, occurrence, value, state, changes, options) {
        const opts = options || {};
        const $target = findIndicatorElement(tag, indicator, occurrence);
        if (!$target.length) return false;
        const previous = ($target.val() || '').toString();
        const next = (value || '').toString();
        if (previous === next) return true;
        if (!opts.skipUndo) {
            recordUndo({ kind: 'indicator', tag, indicator, occurrence: occurrence || '' }, previous, next);
        }
        if (Array.isArray(changes)) {
            changes.push({ kind: 'indicator', tag, indicator, occurrence: occurrence || '', previous, next });
        }
        $target.val(next);
        $target.trigger('change');
        return true;
    }

    function setSubfieldValueWithUndo($target, tag, code, occurrence, value, state, changes, options) {
        const opts = options || {};
        if (!$target || !$target.length) return false;
        const previous = ($target.val() || '').toString();
        const next = (value || '').toString();
        if (previous === next) return true;
        const target = { tag, code, occurrence: occurrence || '' };
        if (!opts.skipUndo) {
            recordUndo(target, previous, next);
        }
        if (Array.isArray(changes)) {
            changes.push({ kind: 'subfield', tag, code, occurrence: occurrence || '', previous, next });
        }
        $target.val(next);
        $target.trigger('change');
        markFieldForRevalidation(state, target);
        return true;
    }

    function guessAddFieldControl(tag) {
        const selector = [
            `[data-tag="${tag}"]`,
            `[data-marc-tag="${tag}"]`,
            `[data-field-tag="${tag}"]`,
            `a[onclick*="tag_${tag}"]`,
            `button[onclick*="tag_${tag}"]`,
            `a[onclick*="${tag}"]`,
            `button[onclick*="${tag}"]`
        ].join(',');
        const $candidates = $(selector).filter(function() {
            const text = ($(this).text() || '').toLowerCase();
            return !text || text.includes('add');
        });
        return $candidates.first();
    }

    function addFieldForTag(tag) {
        const $existing = findFieldElement(tag, 'a', '');
        const beforeCount = collectFieldOccurrences(tag).length;
        try {
            if (typeof window.AddField === 'function') {
                window.AddField(tag);
            } else if (typeof window.addField === 'function') {
                window.addField(tag);
            } else if (typeof window.CloneField === 'function' && $existing.length) {
                window.CloneField($existing.attr('id') || $existing.attr('name'));
            } else if (typeof window.cloneField === 'function' && $existing.length) {
                window.cloneField($existing.attr('id') || $existing.attr('name'));
            } else {
                const $control = guessAddFieldControl(tag);
                if ($control.length) $control.trigger('click');
            }
        } catch (err) {
            // ignore and fall through
        }
        const afterCount = collectFieldOccurrences(tag).length;
        return afterCount > beforeCount;
    }

    function collectFieldOccurrences(tag) {
        if (!isValidTag(tag)) return [];
        const selector = `input[id^="tag_${tag}_subfield_"], textarea[id^="tag_${tag}_subfield_"], select[id^="tag_${tag}_subfield_"], input[id^="subfield${tag}"], textarea[id^="subfield${tag}"], select[id^="subfield${tag}"], input[name^="field_${tag}"], textarea[name^="field_${tag}"], select[name^="field_${tag}"]`;
        const occurrences = new Set();
        $(selector).each(function() {
            const meta = parseFieldMeta(this);
            if (!meta || meta.tag !== tag) return;
            occurrences.add(normalizeOccurrenceKey(meta.occurrence));
        });
        return Array.from(occurrences);
    }

    function cloneSubfieldRow($base, tag, code, occurrence) {
        if (!$base || !$base.length) return $();
        const baseMeta = parseFieldMeta($base[0]);
        const baseCode = baseMeta ? baseMeta.code : code;
        const baseOcc = baseMeta ? baseMeta.occurrence : occurrence;
        const existing = collectSubfieldElements(tag, code, occurrence);
        const suffix = existing.length ? `_${existing.length}` : '';
        const newToken = `${normalizeOccurrenceKey(baseOcc)}${suffix}`;
        const $row = $base.closest('.subfield_line, .subfield, .field, li, div').first();
        const $clone = $row.clone();
        $clone.find('input, textarea, select, label').each(function() {
            const $el = $(this);
            const id = $el.attr('id');
            const name = $el.attr('name');
            if (id) {
                let nextId = id;
                nextId = nextId.replace(new RegExp(`tag_${tag}_subfield_${baseCode}(_\\d+(?:_\\d+)*)?`, 'i'), `tag_${tag}_subfield_${code}_${newToken}`);
                nextId = nextId.replace(new RegExp(`subfield${tag}${baseCode}`, 'i'), `subfield${tag}${code}`);
                if (nextId === id) {
                    nextId = `tag_${tag}_subfield_${code}_${newToken}`;
                }
                $el.attr('id', nextId);
            }
            if (name) {
                let nextName = name;
                nextName = nextName.replace(new RegExp(`tag_${tag}_subfield_${baseCode}(_\\d+(?:_\\d+)*)?`, 'i'), `tag_${tag}_subfield_${code}_${newToken}`);
                nextName = nextName.replace(new RegExp(`field_${tag}${baseCode}`, 'i'), `field_${tag}${code}`);
                if (nextName === name) {
                    nextName = `tag_${tag}_subfield_${code}_${newToken}`;
                }
                $el.attr('name', nextName);
            }
            if ($el.is('label')) {
                $el.text(`$${code}`);
            } else {
                $el.val('');
            }
        });
        $row.after($clone);
        return $clone.find('input, textarea, select').first();
    }

    function ensureSubfieldInput(tag, occurrence, code) {
        const existing = collectSubfieldElements(tag, code, occurrence);
        if (existing.length) return existing.last();
        const $base = findFieldElement(tag, 'a', occurrence);
        if (!$base.length) return $();
        const $added = cloneSubfieldRow($base, tag, code, occurrence);
        return $added.length ? $added : collectSubfieldElements(tag, code, occurrence).last();
    }

    function getFieldValue(tag, code) {
        const $field = findFieldElement(tag, code, '');
        if (!$field.length) return { value: '', element: null, occurrence: '' };
        const meta = parseFieldMeta($field[0]);
        return {
            value: ($field.val() || '').trim(),
            element: $field[0],
            occurrence: meta ? meta.occurrence : ''
        };
    }

    function buildTitleSourceFromParts(title, partNumber, partName, subtitle, responsibility) {
        const parts = [title, partNumber, partName, subtitle, responsibility]
            .map(value => (value || '').toString().trim())
            .filter(Boolean);
        return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
    }

    function getTitleWithSubtitle() {
        const titleInfo = getFieldValue('245', 'a');
        const partNumberInfo = getFieldValue('245', 'n');
        const partNameInfo = getFieldValue('245', 'p');
        const subtitleInfo = getFieldValue('245', 'b');
        const responsibilityInfo = getFieldValue('245', 'c');
        const combined = buildTitleSourceFromParts(
            titleInfo.value,
            partNumberInfo.value,
            partNameInfo.value,
            subtitleInfo.value,
            responsibilityInfo.value
        );
        return {
            value: combined,
            title: titleInfo.value,
            partNumber: partNumberInfo.value,
            partName: partNameInfo.value,
            subtitle: subtitleInfo.value,
            responsibility: responsibilityInfo.value,
            occurrence: titleInfo.occurrence || partNumberInfo.occurrence || partNameInfo.occurrence || subtitleInfo.occurrence || responsibilityInfo.occurrence || '',
            element: titleInfo.element || partNumberInfo.element || partNameInfo.element || subtitleInfo.element || responsibilityInfo.element || null
        };
    }

    function filterCatalogingSubfields(subfields, options) {
        const opts = options || {};
        const maxSubfields = Number.isFinite(opts.maxSubfields) ? opts.maxSubfields : 20;
        const maxChars = Number.isFinite(opts.maxChars) ? opts.maxChars : 1200;
        const maxValueChars = Number.isFinite(opts.maxValueChars) ? opts.maxValueChars : 240;
        const requiredCodes = Array.isArray(opts.requiredCodes)
            ? opts.requiredCodes.map(code => String(code || '').toLowerCase()).filter(Boolean)
            : ['a', 'n', 'p', 'b', 'c'];
        const activeCode = String(opts.activeCode || '').toLowerCase();

        const cleaned = [];
        (subfields || []).forEach(sub => {
            if (!sub || typeof sub !== 'object') return;
            const code = String(sub.code || '').toLowerCase();
            if (!code) return;
            let value = (sub.value !== undefined && sub.value !== null) ? String(sub.value) : '';
            value = value.trim();
            if (!value) return;
            cleaned.push({ code, value });
        });
        if (!cleaned.length) return [];

        const normalizeValue = (value) => {
            if (!value) return '';
            if (maxValueChars && value.length > maxValueChars) {
                return value.slice(0, Math.max(0, maxValueChars - 3)) + '...';
            }
            return value;
        };

        const totalChars = cleaned.reduce((sum, sub) => sum + sub.value.length, 0);
        if ((!maxSubfields || cleaned.length <= maxSubfields) && (!maxChars || totalChars <= maxChars)) {
            return cleaned.map(sub => ({ code: sub.code, value: normalizeValue(sub.value) }));
        }

        let centerIndex = 0;
        if (activeCode) {
            const idx = cleaned.findIndex(sub => sub.code === activeCode);
            if (idx >= 0) centerIndex = idx;
        }

        const selected = new Set();
        cleaned.forEach((sub, idx) => {
            if ((activeCode && sub.code === activeCode) || requiredCodes.includes(sub.code)) {
                selected.add(idx);
            }
        });
        if (!selected.size) selected.add(centerIndex);

        let offset = 1;
        while (selected.size < maxSubfields && (centerIndex - offset >= 0 || centerIndex + offset < cleaned.length)) {
            const left = centerIndex - offset;
            if (left >= 0) selected.add(left);
            if (selected.size >= maxSubfields) break;
            const right = centerIndex + offset;
            if (right < cleaned.length) selected.add(right);
            offset += 1;
        }

        const indices = Array.from(selected).sort((a, b) => a - b).slice(0, maxSubfields);
        const result = [];
        let total = 0;
        indices.forEach(idx => {
            let value = normalizeValue(cleaned[idx].value);
            if (!value) return;
            if (maxChars && total + value.length > maxChars) {
                const remaining = maxChars - total;
                if (remaining <= 3) return;
                value = value.slice(0, Math.max(0, remaining - 3)) + '...';
            }
            total += value.length;
            result.push({ code: cleaned[idx].code, value });
        });
        return result;
    }

    function buildCatalogingTagContext(fieldContext) {
        if (!fieldContext) return null;
        const rawSubfields = Array.isArray(fieldContext.subfields) ? fieldContext.subfields : [];
        let activeCode = '';
        const firstA = rawSubfields.find(sub => sub && String(sub.code || '').toLowerCase() === 'a');
        if (firstA) {
            activeCode = 'a';
        } else if (rawSubfields.length) {
            activeCode = String(rawSubfields[0].code || '').toLowerCase();
        }
        const subfields = filterCatalogingSubfields(rawSubfields, { activeCode });
        const activeSubfield = activeCode || (subfields[0] ? subfields[0].code : '');
        return {
            tag: fieldContext.tag || '245',
            ind1: fieldContext.ind1 || '',
            ind2: fieldContext.ind2 || '',
            occurrence: normalizeOccurrence(fieldContext.occurrence),
            active_subfield: activeSubfield,
            subfields
        };
    }

    function getPreferredCutterSource() {
        const authorInfo = getFieldValue('100', 'a');
        if (authorInfo.value) {
            return { value: authorInfo.value, label: '100$a (author)', tag: '100' };
        }
        const titleInfo = getFieldValue('245', 'a');
        if (titleInfo.value) {
            return { value: titleInfo.value, label: '245$a (title)', tag: '245' };
        }
        return { value: '', label: 'Title', tag: '245' };
    }

    function extractKnownYear(value) {
        if (!value) return '';
        const raw = value.toString().trim();
        if (!raw) return '';
        const lower = raw.toLowerCase();
        if (/[?]/.test(lower)) return '';
        if (/n\.d\.|no date|unknown|undated/.test(lower)) return '';
        if (/\bca\.?\b|\bcirca\b|\bapprox\b|\bapprox\.\b/.test(lower)) return '';
        if (/\d{4}\s*[-/]\s*\d{4}/.test(lower)) return '';
        let cleaned = raw.replace(/[\[\]\(\)©]/g, '').trim();
        cleaned = cleaned.replace(/^(c|copyright)\s*/i, '');
        const matches = cleaned.match(/\b(1[5-9]\d{2}|20\d{2})\b/g) || [];
        if (matches.length !== 1) return '';
        return matches[0];
    }

    function getPublicationYear() {
        const field264 = getFieldValue('264', 'c');
        const field260 = getFieldValue('260', 'c');
        const year = extractKnownYear(field264.value) || extractKnownYear(field260.value);
        return { value: year || '' };
    }

    function buildCutterSanborn(value, sourceTag) {
        if (global.ISBDCutterSanborn && typeof global.ISBDCutterSanborn.build === 'function') {
            return global.ISBDCutterSanborn.build(value, sourceTag);
        }
        return '';
    }

    function buildCallNumberParts(classification, cutter, year, prefix) {
        const classCore = normalizeLcClassForCallNumber(classification || '');
        const classSegment = [prefix || '', classCore].map(item => (item || '').toString().trim()).filter(Boolean).join(' ').trim();
        const cutterSegment = [cutter || '', year || ''].map(item => (item || '').toString().trim()).filter(Boolean).join(' ').trim();
        const full = [classSegment, cutterSegment].filter(Boolean).join(' ').trim();
        return {
            classSegment,
            cutterSegment,
            full
        };
    }

    function buildCallNumber(classification, cutter, year, prefix) {
        return buildCallNumberParts(classification, cutter, year, prefix).full;
    }

    function parseLcTarget(target) {
        const value = (target || '').toString().trim();
        let match = value.match(/^(\d{3})\s*\$\s*(00|[a-z0-9])$/i);
        if (!match) match = value.match(/^(\d{3})(00|[a-z0-9])$/i);
        if (!match) return null;
        return { tag: match[1], code: normalizeSubfieldCode(match[2]) };
    }

    function findCallNumberTarget() {
        const settings = global.AutoPunctuationSettings || {};
        const target = parseLcTarget(settings.lcClassTarget || '');
        const candidates = [];
        if (target) candidates.push(target);
        candidates.push(
            { tag: '050', code: 'a' },
            { tag: '090', code: 'a' },
            { tag: '099', code: 'a' }
        );
        for (const candidate of candidates) {
            const $field = findFieldElement(candidate.tag, candidate.code, '');
            if ($field.length) {
                return { ...candidate, $field };
            }
        }
        return null;
    }

    function clearSubjectFields(tags) {
        (tags || []).forEach(tag => {
            const occurrences = collectFieldOccurrences(tag);
            occurrences.forEach(occ => {
                const selector = `input[id^="tag_${tag}_subfield_"], textarea[id^="tag_${tag}_subfield_"], select[id^="tag_${tag}_subfield_"], input[id^="subfield${tag}"], textarea[id^="subfield${tag}"], select[id^="subfield${tag}"], input[name^="field_${tag}"], textarea[name^="field_${tag}"], select[name^="field_${tag}"]`;
                $(selector).each(function() {
                    const meta = parseFieldMeta(this);
                    if (!meta || meta.tag !== tag) return;
                    if (!isSameOccurrence(meta.occurrence, occ)) return;
                    $(this).val('');
                    $(this).trigger('change');
                });
            });
        });
    }

    function findEmptySubjectField(tag) {
        const $fields = collectSubfieldElements(tag, 'a', '');
        let $candidate = $();
        $fields.each(function() {
            const meta = parseFieldMeta(this);
            if (!meta) return;
            const fieldContext = buildFieldContext(tag, meta.occurrence);
            if (!fieldContext) return;
            const hasValue = (fieldContext.subfields || []).some(sub => (sub.value || '').toString().trim());
            if (!hasValue) {
                $candidate = $(this);
                return false;
            }
        });
        return $candidate;
    }

    function subjectObjectSignature(subject) {
        if (!subject) return '';
        const formatter = global.ISBDAiTextExtract && typeof global.ISBDAiTextExtract.formatSubjectDisplay === 'function'
            ? global.ISBDAiTextExtract.formatSubjectDisplay
            : null;
        let label = '';
        if (formatter) {
            label = formatter(subject) || '';
        } else {
            const sub = subject.subfields || {};
            const parts = [sub.a || ''];
            ['x', 'y', 'z', 'v'].forEach(code => {
                const values = Array.isArray(sub[code]) ? sub[code] : [];
                values.forEach(value => {
                    if (value) parts.push(value);
                });
            });
            label = parts.join(' -- ');
        }
        return normalizeSubjectHeading(label.replace(/^\d{3}[0-9 ]\s*/, '')).toLowerCase();
    }

    function collectExistingSubjectSignatures(tags) {
        const wanted = Array.isArray(tags) && tags.length ? new Set(tags.map(tag => String(tag || ''))) : null;
        const signatures = new Set();
        const record = buildRecordContext();
        (record.fields || []).forEach(field => {
            const tag = String(field.tag || '');
            if (!/^6\d\d$/.test(tag)) return;
            if (wanted && !wanted.has(tag)) return;
            const subfields = field.subfields || [];
            const subject = {
                tag,
                ind1: field.ind1 !== undefined ? field.ind1 : ' ',
                ind2: field.ind2 !== undefined ? field.ind2 : '0',
                subfields: { a: '', x: [], y: [], z: [], v: [] }
            };
            subfields.forEach(sub => {
                if (!sub || !sub.code) return;
                const code = String(sub.code || '').toLowerCase();
                const value = (sub.value || '').toString().trim();
                if (!value) return;
                if (code === 'a') subject.subfields.a = value;
                if (['x', 'y', 'z', 'v'].includes(code)) subject.subfields[code].push(value);
            });
            if (!subject.subfields.a) return;
            const signature = subjectObjectSignature(subject);
            if (signature) signatures.add(signature);
        });
        return signatures;
    }

    function candidateSubjectTags(tag, allowFallback) {
        const primary = (tag || '650').toString();
        if (!allowFallback) return [primary];
        const candidates = [primary, '650', '651', '600', '610', '611', '630', '648', '655'];
        return Array.from(new Set(candidates.filter(Boolean)));
    }

    function findOrCreateEmptySubjectField(tag) {
        let $fieldA = findEmptySubjectField(tag);
        if ($fieldA.length) return $fieldA;
        addFieldForTag(tag);
        $fieldA = findEmptySubjectField(tag);
        return $fieldA;
    }

    function applySubjectObject(subject, settings, state, options) {
        const opts = options || {};
        const changes = [];
        const normalized = normalizeSubjectObjects([subject])[0];
        if (!normalized || !normalized.subfields || !normalized.subfields.a) {
            return { ok: false, reason: 'invalid' };
        }
        const signature = subjectObjectSignature(normalized);
        const existingSignatures = opts.existingSignatures instanceof Set ? opts.existingSignatures : null;
        if (!opts.replace && existingSignatures && signature && existingSignatures.has(signature)) {
            return { ok: false, reason: 'duplicate' };
        }
        const ind1 = normalized.ind1 !== undefined ? normalized.ind1 : ' ';
        const ind2 = normalized.ind2 !== undefined ? normalized.ind2 : '0';
        const tags = candidateSubjectTags(normalized.tag || '650', opts.allowTagFallback !== false);
        let chosenTag = '';
        let $fieldA = $();
        tags.some(tag => {
            const $candidate = findOrCreateEmptySubjectField(tag);
            if (!$candidate.length) return false;
            chosenTag = tag;
            $fieldA = $candidate;
            return true;
        });
        if (!$fieldA.length || !chosenTag) {
            return { ok: false, reason: 'no_target' };
        }
        const meta = parseFieldMeta($fieldA[0]);
        if (!meta) return { ok: false, reason: 'no_target' };
        const occurrence = meta.occurrence;
        setIndicatorValueWithUndo(chosenTag, 1, occurrence, ind1, state, changes, opts);
        setIndicatorValueWithUndo(chosenTag, 2, occurrence, ind2, state, changes, opts);
        ['a', 'x', 'y', 'z', 'v'].forEach(code => {
            collectSubfieldElements(chosenTag, code, occurrence).each(function() {
                setSubfieldValueWithUndo($(this), chosenTag, code, occurrence, '', state, changes, opts);
            });
        });
        const setValueAtIndex = (code, value, index) => {
            let $targets = collectSubfieldElements(chosenTag, code, occurrence);
            while ($targets.length <= index) {
                ensureSubfieldInput(chosenTag, occurrence, code);
                $targets = collectSubfieldElements(chosenTag, code, occurrence);
            }
            const $target = $targets.eq(index);
            if ($target.length) {
                setSubfieldValueWithUndo($target, chosenTag, code, occurrence, value, state, changes, opts);
            }
        };
        setValueAtIndex('a', normalized.subfields.a, 0);
        ['x', 'y', 'z', 'v'].forEach(code => {
            const values = Array.isArray(normalized.subfields[code]) ? normalized.subfields[code] : [];
            values.forEach((value, idx) => {
                if (value) setValueAtIndex(code, value, idx);
            });
        });
        if (existingSignatures && signature) existingSignatures.add(signature);
        return { ok: true, reason: 'applied', tag: chosenTag, changes };
    }

    function applyAiSubjects(settings, state) {
        const $panel = $('#isbd-ai-panel');
        const subjects = state && state.aiSuggestions ? state.aiSuggestions.subjects || [] : [];
        if (!subjects.length) {
            toast('info', 'No subject headings to apply.');
            return;

        }
        const normalizedSubjects = normalizeSubjectObjects(subjects || []);
        if (state && state.aiSuggestions) {
            state.aiSuggestions.subjects = normalizedSubjects;
        }
        if (state && state.readOnly) {
            toast('warning', 'Auto-apply disabled for training.');
            return;
        }
        const replace = $panel.find('#isbd-ai-subjects-replace').is(':checked');
        const existingSignatures = collectExistingSubjectSignatures();
        if (replace) {
            if (!confirm('Replace existing subject fields for these tags? This cannot be undone.')) return;
            const tags = Array.from(new Set(normalizedSubjects.map(sub => sub.tag || '650')));
            clearSubjectFields(tags);
            existingSignatures.clear();
            if (state) state.aiSubjectHistory = {};
        }
        let applied = 0;
        let duplicates = 0;
        let failed = 0;
        normalizedSubjects.forEach((subject, index) => {
            const result = applySubjectObject(subject, settings, state, {
                replace,
                existingSignatures,
                allowTagFallback: true
            });
            if (result && result.ok) {
                applied += 1;
                if (state) {
                    if (!state.aiSubjectHistory || typeof state.aiSubjectHistory !== 'object') state.aiSubjectHistory = {};
                    state.aiSubjectHistory[index] = {
                        undoChanges: cloneSubjectChanges(result.changes || []),
                        redoChanges: []
                    };
                }
            } else if (result && result.reason === 'duplicate') {
                duplicates += 1;
            } else {
                failed += 1;
            }
        });
        if (!applied) {
            if (duplicates && !failed) {
                toast('info', 'Suggested subjects are already present; nothing new was applied.');
            } else {
                toast('warning', 'Unable to apply subjects automatically. Ensure at least one 6xx subject field is available and retry.');
            }
            return;
        }
        refreshAll(settings);
        let message = `Applied ${applied} subject heading${applied > 1 ? 's' : ''}.`;
        if (duplicates) message += ` Skipped ${duplicates} duplicate${duplicates > 1 ? 's' : ''}.`;
        if (failed) message += ` ${failed} suggestion${failed > 1 ? 's' : ''} could not be applied automatically.`;
        toast(failed ? 'warning' : 'info', message);
    }

    function applyAiSubjectByIndex(settings, state, index) {
        const subjects = normalizeSubjectObjects((state && state.aiSuggestions ? state.aiSuggestions.subjects || [] : []) || []);
        if (!subjects.length) {
            toast('info', 'No subject headings to apply.');
            return false;
        }
        let subject = subjects[index];
        if (!subject) {
            toast('warning', 'Selected subject suggestion is no longer available.');
            return false;
        }
        if (subject.authority && subject.authority.match_type === 'variant_match'
            && subject.authority.authorized_heading) {
            subject = {
                ...subject,
                subfields: {
                    ...(subject.subfields || {}),
                    a: subject.authority.authorized_heading
                }
            };
        }
        if (state && state.readOnly) {
            toast('warning', 'Auto-apply disabled for training.');
            return false;
        }
        const $panel = $('#isbd-ai-panel');
        const replace = $panel.find('#isbd-ai-subjects-replace').is(':checked');
        const existingSignatures = collectExistingSubjectSignatures();
        if (replace) {
            if (!confirm('Replace existing subject fields for this tag? This cannot be undone.')) return false;
            clearSubjectFields([subject.tag || '650']);
            existingSignatures.clear();
            if (state) state.aiSubjectHistory = {};
        }
        const result = applySubjectObject(subject, settings, state, {
            replace,
            existingSignatures,
            allowTagFallback: true
        });
        if (!result || !result.ok) {
            if (result && result.reason === 'duplicate') {
                toast('info', 'This subject is already present.');
            } else {
                toast('warning', 'Unable to apply the selected subject automatically. Ensure a 6xx subject field is available and retry.');
            }
            return false;
        }
        if (state) {
            if (!state.aiSubjectHistory || typeof state.aiSubjectHistory !== 'object') state.aiSubjectHistory = {};
            state.aiSubjectHistory[index] = {
                undoChanges: cloneSubjectChanges(result.changes || []),
                redoChanges: []
            };
        }
        refreshAll(settings);
        toast('info', 'Applied 1 subject heading.');
        return true;
    }

    function undoAiSubjectApplyByIndex(settings, state, index) {
        if (!state || state.readOnly) return false;
        const history = (state.aiSubjectHistory && typeof state.aiSubjectHistory === 'object')
            ? state.aiSubjectHistory
            : {};
        const entry = history[index];
        if (!entry || !Array.isArray(entry.undoChanges) || !entry.undoChanges.length) {
            toast('info', 'Nothing to undo for this subject.');
            return false;
        }
        if (!applySubjectChangeList(entry.undoChanges, 'previous', state)) {
            toast('warning', 'Unable to undo this subject change.');
            return false;
        }
        entry.redoChanges = cloneSubjectChanges(entry.undoChanges);
        entry.undoChanges = [];
        refreshAll(settings);
        toast('info', 'Subject change undone.');
        return true;
    }

    function redoAiSubjectApplyByIndex(settings, state, index) {
        if (!state || state.readOnly) return false;
        const history = (state.aiSubjectHistory && typeof state.aiSubjectHistory === 'object')
            ? state.aiSubjectHistory
            : {};
        const entry = history[index];
        if (!entry || !Array.isArray(entry.redoChanges) || !entry.redoChanges.length) {
            toast('info', 'Nothing to redo for this subject.');
            return false;
        }
        if (!applySubjectChangeList(entry.redoChanges, 'next', state)) {
            toast('warning', 'Unable to redo this subject change.');
            return false;
        }
        entry.undoChanges = cloneSubjectChanges(entry.redoChanges);
        entry.redoChanges = [];
        refreshAll(settings);
        toast('info', 'Subject change redone.');
        return true;
    }

    function parseRequiredFieldToken(value) {
        const token = (value || '').toString().trim().toLowerCase();
        const match = token.match(/^(\d{3})(\*|00|[a-z0-9])$/i);
        if (!match) return null;
        return { raw: token, tag: match[1], code: normalizeSubfieldCode(match[2]) };
    }

    function collectDynamicRequiredFieldTokens() {
        const tokens = [];
        const seen = new Set();
        const addToken = value => {
            const parsed = parseRequiredFieldToken(value);
            if (!parsed) return;
            const key = `${parsed.tag}${parsed.code}`;
            if (seen.has(key)) return;
            seen.add(key);
            tokens.push(key);
        };
        const addFromElements = $elements => {
            ($elements || $()).each(function() {
                const meta = parseFieldMeta(this);
                if (!meta) return;
                addToken(`${meta.tag}${meta.code}`);
            });
        };

        $('label .required, label.required').each(function() {
            const $label = $(this).closest('label');
            const forId = $label.attr('for');
            if (forId) {
                const target = document.getElementById(forId);
                if (target) addFromElements($(target));
            }
            addFromElements($label.find('input, textarea, select'));
        });

        $('.required').each(function() {
            const $required = $(this);
            const $row = $required.closest('li.subfield_line, tr, .subfield_line, .subfield, li, td, th');
            if ($row.length) addFromElements($row.first().find('input, textarea, select'));
            addFromElements($required.siblings('input, textarea, select'));
            addFromElements($required.parent().find('input, textarea, select'));
        });

        return tokens;
    }

    function getRequiredFieldTokens(state) {
        const merged = [];
        const seen = new Set();
        const configured = (state && Array.isArray(state.requiredFieldsConfigured))
            ? state.requiredFieldsConfigured
            : ((state && Array.isArray(state.requiredFields)) ? state.requiredFields : []);
        const dynamic = collectDynamicRequiredFieldTokens();
        const addTokens = source => {
            (source || []).forEach(item => {
                const parsed = parseRequiredFieldToken(item);
                if (!parsed) return;
                const key = `${parsed.tag}${parsed.code}`;
                if (seen.has(key)) return;
                seen.add(key);
                merged.push(key);
            });
        };
        addTokens(configured);
        addTokens(dynamic);
        if (state) state.requiredFields = merged;
        return merged;
    }

    function anyFieldHasValue(tag, code) {
        const normalizedTag = normalizeTag(tag);
        const normalizedCode = normalizeSubfieldCode(code);
        if (!isValidTag(normalizedTag) || !isValidSubfieldCode(normalizedCode)) return false;
        const selectors = [];
        subfieldCodeVariants(normalizedCode).forEach(variant => {
            selectors.push(
                `#subfield${normalizedTag}${variant}`,
                `input[id^="tag_${normalizedTag}_subfield_${variant}"]`,
                `textarea[id^="tag_${normalizedTag}_subfield_${variant}"]`,
                `select[id^="tag_${normalizedTag}_subfield_${variant}"]`,
                `#tag_${normalizedTag}_subfield_${variant}`,
                `input[name^="field_${normalizedTag}${variant}"]`,
                `textarea[name^="field_${normalizedTag}${variant}"]`,
                `select[name^="field_${normalizedTag}${variant}"]`
            );
        });
        if (normalizedCode === '0') {
            selectors.push(
                `input[id^="field_${normalizedTag}"]`,
                `textarea[id^="field_${normalizedTag}"]`,
                `select[id^="field_${normalizedTag}"]`,
                `input[name^="field_${normalizedTag}"]`,
                `textarea[name^="field_${normalizedTag}"]`,
                `select[name^="field_${normalizedTag}"]`
            );
        }
        const selector = selectors.join(', ');
        let found = false;
        $(selector).each(function() {
            const value = ($(this).val() || '').toString().trim();
            if (!value) return;
            if (normalizedCode === '0') {
                const meta = parseFieldMeta(this);
                if (meta && meta.tag === normalizedTag && normalizeSubfieldCode(meta.code) !== '0') return;
            }
            found = true;
            return false;
        });
        return found;
    }

    function anyTagHasAnySubfieldValue(tag) {
        const normalizedTag = normalizeTag(tag);
        if (!isValidTag(normalizedTag)) return false;
        const selector = `input[id^="tag_${normalizedTag}_subfield_"], textarea[id^="tag_${normalizedTag}_subfield_"], select[id^="tag_${normalizedTag}_subfield_"], input[id^="subfield${normalizedTag}"], textarea[id^="subfield${normalizedTag}"], select[id^="subfield${normalizedTag}"], input[name^="field_${normalizedTag}"], textarea[name^="field_${normalizedTag}"], select[name^="field_${normalizedTag}"]`;
        let found = false;
        $(selector).each(function() {
            const id = (this.id || '').toLowerCase();
            const name = (this.name || '').toLowerCase();
            if (id.includes('indicator') || name.includes('indicator')) return;
            const value = ($(this).val() || '').toString().trim();
            if (!value) return;
            const meta = parseFieldMeta(this);
            if (meta && meta.tag && meta.tag !== normalizedTag) return;
            if (!meta && !id.includes(`field_${normalizedTag}`) && !name.includes(`field_${normalizedTag}`)) return;
            found = true;
            return false;
        });
        return found;
    }

    function focusTagField(tag) {
        const normalizedTag = normalizeTag(tag);
        if (!isValidTag(normalizedTag)) return;
        const selector = `input[id^="tag_${normalizedTag}_subfield_"], textarea[id^="tag_${normalizedTag}_subfield_"], select[id^="tag_${normalizedTag}_subfield_"], input[id^="subfield${normalizedTag}"], textarea[id^="subfield${normalizedTag}"], select[id^="subfield${normalizedTag}"], input[name^="field_${normalizedTag}"], textarea[name^="field_${normalizedTag}"], select[name^="field_${normalizedTag}"]`;
        let $field = $();
        $(selector).each(function() {
            const id = (this.id || '').toLowerCase();
            const name = (this.name || '').toLowerCase();
            if (id.includes('indicator') || name.includes('indicator')) return;
            const meta = parseFieldMeta(this);
            if (meta && meta.tag !== normalizedTag) return;
            $field = $(this);
            return false;
        });
        if (!$field.length) {
            toast('warning', `Field ${normalizedTag} not found on form.`);
            return;
        }
        const tabId = findFieldTabId($field);
        if (tabId) {
            activateTab(tabId);
        }
        setTimeout(() => {
            $('html, body').animate({ scrollTop: $field.offset().top - 120 }, 200);
            $field.focus();
            $field.addClass('isbd-focus-flash');
            setTimeout(() => $field.removeClass('isbd-focus-flash'), 1200);
        }, tabId ? 160 : 0);
    }

    function anyTagHasValue(tags, code) {
        return (tags || []).some(tag => anyFieldHasValue(tag, code));
    }

    function pickGuardrailTarget(tags, code) {
        for (const tag of tags || []) {
            const $field = findFieldElement(tag, code, '');
            if ($field.length) return { tag, subfield: code };
        }
        return null;
    }

    function focusField(tag, code, occurrence) {
        const normalizedTag = normalizeTag(tag);
        const normalizedCode = normalizeSubfieldCode(code);
        let $field = findFieldElement(normalizedTag, normalizedCode, occurrence);
        if (!$field.length) {
            const selector = 'input[id*="subfield"], textarea[id*="subfield"], select[id*="subfield"], input[name*="subfield"], textarea[name*="subfield"], select[name*="subfield"], input[name^="field_"], textarea[name^="field_"], select[name^="field_"]';
            const codeVariants = subfieldCodeVariants(normalizedCode);
            $field = $(selector).filter(function() {
                const meta = parseFieldMeta(this);
                if (meta) {
                    if (normalizeTag(meta.tag) !== normalizedTag) return false;
                    return codeVariants.includes(normalizeSubfieldCode(meta.code));
                }
                const id = (this.id || '').toLowerCase();
                const name = (this.name || '').toLowerCase();
                return codeVariants.some(variant => {
                    const subfieldNeedle = `tag_${normalizedTag}_subfield_${variant}`;
                    const fieldNeedle = `field_${normalizedTag}${variant}`;
                    return id.includes(subfieldNeedle)
                        || name.includes(subfieldNeedle)
                        || id.includes(fieldNeedle)
                        || name.includes(fieldNeedle);
                });
            }).first();
        }
        if (!$field.length) {
            toast('warning', `Field ${normalizedTag}$${normalizedCode} not found on form.`);
            return;
        }
        const tabId = findFieldTabId($field);
        if (tabId) {
            activateTab(tabId);
        }
        setTimeout(() => {
            $('html, body').animate({ scrollTop: $field.offset().top - 120 }, 200);
            $field.focus();
            $field.addClass('isbd-focus-flash');
            setTimeout(() => $field.removeClass('isbd-focus-flash'), 1200);
        }, tabId ? 160 : 0);
    }

    function findFieldTabId($field) {
        if (!$field || !$field.length) return '';
        const $pane = $field.closest('.tab-pane');
        if ($pane.length && $pane.attr('id')) return $pane.attr('id');
        const $panel = $field.closest('[id$="_panel"]');
        if ($panel.length && $panel.attr('id')) return $panel.attr('id');
        const $any = $field.closest('[id]');
        if ($any.length) {
            const id = $any.attr('id');
            const $tab = $(`a[href="#${id}"], a[data-bs-target="#${id}"], a[aria-controls="${id}"]`);
            if ($tab.length) return id;
        }
        return '';
    }

    function buildHelpText(finding) {
        const parts = [];
        if (finding.message) parts.push(finding.message);
        if (finding.rationale) parts.push(finding.rationale);
        if (finding.examples && finding.examples.length) {
            const ex = finding.examples[0];
            if (ex && ex.before !== undefined && ex.after !== undefined) {
                parts.push(`Example: ${ex.before} → ${ex.after}`);
            }
        }
        const conditionNote = buildConditionalSuffixNote(finding);
        if (conditionNote) parts.push(conditionNote);
        return parts.join('\n');
    }

    function escapeAttr(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    const regexWarnings = new Set();
    function safeRegexTest(pattern, value, label) {
        if (!pattern) return true;
        if (pattern.length > 120) {
            const message = `${label} regex is too long or complex; rule skipped.`;
            if (!regexWarnings.has(message)) {
                regexWarnings.add(message);
                toast('warning', message);
            }
            return false;
        }
        if (/\([^)]*(?:\+|\*|\{\d+,?\d*\})[^)]*\)(?:\+|\*|\?|\{\d+,?\d*\})/.test(pattern)
            || /\.\*(?:\+|\*)/.test(pattern)) {
            const message = `${label} regex is too complex; rule skipped.`;
            if (!regexWarnings.has(message)) {
                regexWarnings.add(message);
                toast('warning', message);
            }
            return false;
        }
        try {
            return new RegExp(pattern).test(value);
        } catch (err) {
            const message = `${label} regex is invalid; rule skipped.`;
            if (!regexWarnings.has(message)) {
                regexWarnings.add(message);
                toast('warning', message);
            }
            return false;
        }
    }

    function ruleMatchesForGuide(rule, tag, code) {
        if (rule.tag && rule.tag !== tag) return false;
        if (rule.tag_pattern && !safeRegexTest(rule.tag_pattern, tag, `Rule ${rule.id || 'unknown'} tag_pattern`)) return false;
        if (rule.subfields && Array.isArray(rule.subfields)) {
            return rule.subfields.map(x => x.toLowerCase()).includes(code.toLowerCase());
        }
        if (rule.subfield_pattern) {
            return safeRegexTest(rule.subfield_pattern, code, `Rule ${rule.id || 'unknown'} subfield_pattern`);
        }
        return true;
    }

    function filterGuideRules(rules) {
        if (rules.length <= 1) return rules;
        const filtered = rules.filter(rule => !rule.only_when_no_other_rule);
        return filtered.length ? filtered : rules;
    }

    function isMeaningfulExample(example) {
        if (!example) return false;
        const before = (example.before || '').toString();
        const after = (example.after || '').toString();
        if (!before.trim() || !after.trim()) return false;
        return before !== after;
    }

    function getRuleExample(rule) {
        if (!rule || !rule.examples || !rule.examples.length) return null;
        const example = rule.examples[0];
        return isMeaningfulExample(example) ? example : null;
    }

    function normalizeFrameworkFields(settings) {
        if (!settings) return [];
        if (Array.isArray(settings.frameworkFields)) return settings.frameworkFields;
        if (typeof settings.frameworkFields === 'string') {
            try {
                const parsed = JSON.parse(settings.frameworkFields);
                if (Array.isArray(parsed)) return parsed;
            } catch (err) {
                return [];
            }
        }
        return [];
    }

    function collectDomFieldGroups(settings, state) {
        const groups = new Map();
        const selector = 'input[id*="subfield"], input[id*="tag_"], textarea[id*="subfield"], textarea[id*="tag_"], input[name^="field_"], textarea[name^="field_"]';
        $(selector).each(function() {
            const meta = parseFieldMeta(this);
            if (!meta) return;
            if (!isGuideSubfieldCode(meta.code)) return;
            if (isExcluded(settings, state, meta.tag, meta.code)) return;
            const key = `${meta.tag}${meta.code}`;
            if (!groups.has(key)) {
                groups.set(key, { tag: meta.tag, code: meta.code, entries: [] });
            }
            groups.get(key).entries.push({
                tag: meta.tag,
                code: meta.code,
                occurrence: meta.occurrence || '',
                element: $(this)
            });
        });
        return groups;
    }

    function guideStepSortKey(step) {
        const tag = (step.tag || '').trim();
        const code = (step.code || '').trim();
        const tagKey = tag ? tag : 'zzz';
        const codeKey = code ? code : 'zz';
        const titleKey = (step.title || '').toLowerCase();
        return `${tagKey}:${codeKey}:${titleKey}`;
    }

    function compareGuideSteps(a, b) {
        return guideStepSortKey(a).localeCompare(guideStepSortKey(b));
    }

    function prioritizeGuideSteps(steps, state) {
        if (!state) return steps;
        const missing = Array.isArray(state.missingRequired) ? state.missingRequired : [];
        return steps
            .map((step, index) => {
                const occurrenceKey = normalizeOccurrenceKey(step.occurrence);
                const key = `${step.tag}${step.code}:${occurrenceKey}`;
                const hasFinding = state.findings && state.findings.has(key);
                const isMissing = missing.includes(`${step.tag}${step.code}`);
                const priority = (hasFinding || isMissing) ? 0 : 1;
                return { step, index, priority, sortKey: guideStepSortKey(step) };
            })
            .sort((a, b) => (a.priority - b.priority) || a.sortKey.localeCompare(b.sortKey) || (a.index - b.index))
            .map(item => item.step);
    }

    function guideRuleScore(rule, tag, code, entries) {
        let score = 0;
        if (rule.tag && rule.tag === tag) score += 6;
        if (rule.tag_pattern) score += 2;
        if (rule.subfields && Array.isArray(rule.subfields) && rule.subfields.map(x => x.toLowerCase()).includes(code.toLowerCase())) score += 4;
        if (rule.subfield_pattern) score += 2;
        if (entries && entries.length) {
            const matchesExisting = entries.some(entry => {
                const fieldContext = buildFieldContext(tag, entry.occurrence || '');
                return fieldContext && ruleAppliesToField(rule, fieldContext, code);
            });
            if (matchesExisting) score += 5;
        }
        if (getRuleExample(rule)) score += 1;
        if (rule.rationale) score += 1;
        return score;
    }

    function selectBestGuideRule(rules, tag, code, entries) {
        if (!rules.length) return null;
        let best = rules[0];
        let bestScore = guideRuleScore(best, tag, code, entries);
        rules.slice(1).forEach(rule => {
            const score = guideRuleScore(rule, tag, code, entries);
            if (score > bestScore) {
                best = rule;
                bestScore = score;
                return;
            }
            if (score === bestScore) {
                const bestHasExample = !!getRuleExample(best);
                const ruleHasExample = !!getRuleExample(rule);
                if (ruleHasExample && !bestHasExample) {
                    best = rule;
                    bestScore = score;
                }
            }
        });
        return best;
    }

    function selectBestFieldEntry(entries, rule, tag, code) {
        if (!entries || !entries.length) return null;
        for (const entry of entries) {
            const fieldContext = buildFieldContext(tag, entry.occurrence || '');
            if (fieldContext && ruleAppliesToField(rule, fieldContext, code)) {
                return entry;
            }
        }
        return entries[0];
    }

    function buildDecisionGuideSteps(settings, state) {
        const rulesById = new Map((state.rules || []).map(rule => [rule.id, rule]));
        const steps = [
            {
                id: 'tg-245-a-tier1',
                module: 'Title & Statement (245/246)',
                tier: 'Tier 1',
                title: '245 $a Title proper',
                tag: '245',
                code: 'a',
                ruleId: 'ISBD_TITLE_245A_001',
                text: 'Title proper punctuation depends on whether related semantic elements exist.',
                tree: [
                    'If a non-empty $b/$n/$p/$c exists, do not add a trailing period to $a, regardless of entry order.',
                    'If $a is semantically final, add "." unless it already ends with . ? ! ] ).',
                    'Empty subfields are treated as absent — if $b exists but is blank, $a still needs terminal period.',
                    'Preserve ellipses that belong to the title data.',
                    'Do not normalize bracket style automatically.'
                ],
                examples: [
                    { before: 'The great Gatsby', after: 'The great Gatsby.' },
                    { before: 'Who are you?', after: 'Who are you?' },
                    { before: 'When a line bends... a shape begins', after: 'When a line bends- a shape begins' }
                ]
            },
            {
                id: 'tg-245-b-tier1',
                module: 'Title & Statement (245/246)',
                tier: 'Tier 1',
                title: '245 $b Other title info / parallel title',
                tag: '245',
                code: 'b',
                ruleId: 'ISBD_TITLE_245B_001',
                text: 'Other title information and parallel titles.',
                tree: [
                    'Prefix other title info with " : ".',
                    'If $b begins with "=", use " = " instead.',
                    'If related $c exists, suppress generated terminal punctuation on $b; $c receives the " / " prefix.',
                    'If related $c does not exist, end $b with "." while preserving intrinsic abbreviation points.'
                ],
                examples: [
                    { before: 'a novel', after: ' : a novel.' },
                    { before: 'a novel', after: ' : a novel' },
                    { before: '= Le grand Gatsby', after: ' = Le grand Gatsby.' },
                    { before: ' : a novel', after: ' : a novel.' }
                ]
            },
            {
                id: 'tg-245-h-tier3',
                module: 'Title & Statement (245/246)',
                tier: 'Tier 3',
                title: '245 $h GMD handling',
                tag: '245',
                code: 'h',
                text: 'Do not auto-insert or normalize GMD brackets unless local policy explicitly requires it.',
                tree: [
                    'Treat $h content as entered by cataloger/local practice.',
                    'Do not auto-wrap text in [ ] in this plugin layer.',
                    'Preserve existing punctuation unless a local rule is configured.'
                ],
                examples: [
                    { before: '[videorecording]', after: '[videorecording]' }
                ]
            },
            {
                id: 'tg-245-n-tier2',
                module: 'Title & Statement (245/246)',
                tier: 'Tier 2',
                title: '245 $n Numbering',
                tag: '245',
                code: 'n',
                ruleId: 'ISBD_TITLE_245N_001',
                text: 'Numbering or part designation punctuation.',
                tree: [
                    'Prefix numbering with ". " when it follows $a or $b.',
                    'If $p follows, end $n with ", " to link the part title.',
                    'Avoid double commas if $n already ends with a comma.'
                ],
                examples: [
                    { before: 'Part 1', after: '. Part 1,' },
                    { before: 'Part 1,', after: '. Part 1,' }
                ]
            },
            {
                id: 'tg-245-p-tier2',
                module: 'Title & Statement (245/246)',
                tier: 'Tier 2',
                title: '245 $p Part title',
                tag: '245',
                code: 'p',
                ruleId: 'ISBD_TITLE_245P_001',
                text: 'Part title punctuation depends on whether $n is present.',
                tree: [
                    'If $n precedes, prefix $p with ", ".',
                    'If no $n, prefix $p with ". ".',
                    'End with "." only if $b or $c does not follow.'
                ],
                examples: [
                    { before: 'The early years', after: ', The early years.' },
                    { before: '. The early years', after: '. The early years.' }
                ]
            },
            {
                id: 'tg-245-c-tier1',
                module: 'Title & Statement (245/246)',
                tier: 'Tier 1',
                title: '245 $c Statement of responsibility',
                tag: '245',
                code: 'c',
                ruleId: 'ISBD_TITLE_245C_001',
                text: 'Statement of responsibility punctuation.',
                tree: [
                    'First statement: type the responsibility text; the engine supplies the " / " prefix on 245$c when a title subfield precedes it.',
                    'Do not place " / " at the end of 245$b under the baseline rules.',
                    'Additional statements: prefix with " ; ".',
                    'End the final statement with ".".'
                ],
                examples: [
                    { before: '/ F. Scott Fitzgerald', after: ' / F. Scott Fitzgerald.' },
                    { before: 'edited by John Smith', after: ' / edited by John Smith.' }
                ]
            },
            {
                id: 'tg-246-a-tier2',
                module: 'Title & Statement (245/246)',
                tier: 'Tier 2',
                title: '246 variant title',
                tag: '246',
                code: 'a',
                ruleId: 'ISBD_VARIANT_TITLE_246_IND13',
                text: 'Variant title punctuation depends on indicator value.',
                tree: [
                    'Do not manufacture terminal punctuation in field 246, including ind1=3.',
                    'Preserve punctuation that is genuinely part of the variant title data.',
                    'Display text in $i ending with ":" is display behavior, not MARC subfield punctuation.'
                ],
                examples: [
                    { before: 'Great Gatsby', after: 'Great Gatsby', note: 'ind1=3: no manufactured period' },
                    { before: 'Great Gatsby', after: 'Great Gatsby', note: 'ind1=0: no forced period' }
                ]
            },
            {
                id: 'tg-dependent-punctuation-tier2',
                module: 'Title & Statement (245/246)',
                tier: 'Tier 2',
                title: 'Re-check dependent punctuation',
                tag: '',
                code: '',
                text: 'When related subfields are added or removed, semantic dependencies are re-evaluated without using DOM order.',
                tree: [
                    'If non-empty $b/$c/$n/$p is added anywhere in 245, re-evaluate terminal punctuation on $a.',
                    'If related $b/$c/$n/$p is removed, re-evaluate terminal punctuation on $a.',
                    'Apply the same dependency checks for 260/264 $a/$b, 300 $a/$b/$c/$e, 490 $a/$v, and 6xx subdivisions.',
                    'Prefix-suffix interdependence: the colon between $a and $b belongs to one, not both — do not duplicate.',
                    'Empty subfields are treated as absent for punctuation dependency checks.',
                    'Double punctuation (A.3.2.7): abbreviation period + prescribed period are both retained (e.g., "3rd ed.. — ").'
                ],
                examples: [
                    { before: '245 $a The great Gatsby.', after: '245 $a The great Gatsby $b : a novel.' },
                    { before: '300 $c 23 cm $a xii, 180 p.', after: '300 $a xii, 180 p. ; $c 23 cm' }
                ]
            },
            {
                id: 'tg-245-or-tier3',
                module: 'Title & Statement (245/246)',
                tier: 'Tier 3',
                title: 'Alternative title with "or"',
                tag: '',
                code: '',
                text: 'Alternative titles use commas around "or".',
                tree: [
                    'Precede and follow the word "or" with commas.',
                    'Capitalize the first word after "or".',
                    'Use judgment: this applies only when "or" introduces an alternate title.'
                ],
                examples: [
                    { before: 'The Newcastle rider or Ducks and pease', after: 'The Newcastle rider, or, Ducks and pease' },
                    { before: 'How to keep well or The preservation of health', after: 'How to keep well, or, The preservation of health' }
                ]
            },
            {
                id: 'tg-260-a-tier1',
                module: 'Publication (260/264)',
                tier: 'Tier 1',
                title: '260/264 $a Place of publication',
                tag: '260',
                code: 'a',
                ruleId: 'ISBD_PUBL_260A_HAS_B',
                alternateTags: ['264'],
                text: 'Place of publication punctuation.',
                tree: [
                    'If $b or $c follows, end $a with " : ".',
                    'If $a is last, end with ".".',
                    'Use [S.l.] for unknown place.'
                ],
                examples: [
                    { before: 'London', after: 'London :' },
                    { before: '[S.l.]', after: '[S.l.] :' }
                ]
            },
            {
                id: 'tg-260-b-tier1',
                module: 'Publication (260/264)',
                tier: 'Tier 1',
                title: '260/264 $b Publisher',
                tag: '260',
                code: 'b',
                ruleId: 'ISBD_PUBL_260B',
                alternateTags: ['264'],
                text: 'Publisher punctuation.',
                tree: [
                    'If $c follows, end $b with ", ".',
                    'If $b is last, end with ".".',
                    'Use [s.n.] for unknown publisher.'
                ],
                examples: [
                    { before: 'Scribner', after: 'Scribner,' },
                    { before: '[s.n.]', after: '[s.n.],' }
                ]
            },
            {
                id: 'tg-260-c-tier1',
                module: 'Publication (260/264)',
                tier: 'Tier 1',
                title: '260/264 $c Date of publication',
                tag: '260',
                code: 'c',
                ruleId: 'ISBD_PUBL_260C',
                alternateTags: ['264'],
                text: 'Publication date punctuation.',
                tree: [
                    'End the date with "." even when bracketed.',
                    'Use [19--] or [ca. 19--] for unknown dates.'
                ],
                examples: [
                    { before: '1925', after: '1925.' },
                    { before: '[19--]', after: '[19--].' },
                    { before: '[ca. 19--]', after: '[ca. 19--].' }
                ]
            },
            {
                id: 'tg-260-unknown-tier2',
                module: 'Publication (260/264)',
                tier: 'Tier 2',
                title: 'Unknown place/publisher/date',
                tag: '',
                code: '',
                text: 'Use bracketed placeholders when data is missing.',
                tree: [
                    'Unknown place: use "[S.l.]".',
                    'Unknown publisher: use "[s.n.]".',
                    'Unknown date: use "[19--]" or "ca. 19--".'
                ],
                examples: [
                    { before: 'S.l. : s.n.', after: '[S.l.] : [s.n.], [19--].' },
                    { before: 'n.p., n.d.', after: '[S.l.] : [s.n.], [19--].' }
                ]
            },
            {
                id: 'tg-300-a-tier1',
                module: 'Physical Description (300)',
                tier: 'Tier 1',
                title: '300 $a Extent',
                tag: '300',
                code: 'a',
                ruleId: 'ISBD_PHYS_300A_HAS_B',
                text: 'Extent punctuation.',
                tree: [
                    'If related $b exists, end the final $a with " : ".',
                    'If no $b but related $c exists, end the final $a with " ; ".',
                    'If no $b/$c but related $e exists, end the final $a with " + ".',
                    'If $a is semantically final, do not manufacture a period.'
                ],
                examples: [
                    { before: 'xii, 180 p :', after: 'xii, 180 p' },
                    { before: 'xii, 180 p', after: 'xii, 180 p :' },
                    { before: '1 volume', after: '1 volume +' },
                    { before: 'xii, 180 p', after: 'xii, 180 p ;' }
                ]
            },
            {
                id: 'tg-300-b-tier1',
                module: 'Physical Description (300)',
                tier: 'Tier 1',
                title: '300 $b Other physical details',
                tag: '300',
                code: 'b',
                ruleId: 'ISBD_PHYS_300B_HAS_C',
                text: 'Other physical details punctuation.',
                tree: [
                    'Prefix with " : " after $a.',
                    'If $c follows, end with " ; ".',
                    'If $e follows and $c is absent, end with " + ".',
                    'If $b is semantically final, do not manufacture a period.'
                ],
                examples: [
                    { before: ': ill', after: 'ill' },
                    { before: 'maps', after: ' : maps ;' },
                    { before: 'illustrations', after: ' : illustrations +' },
                    { before: ': charts', after: 'charts' }
                ]
            },
            {
                id: 'tg-300-c-tier1',
                module: 'Physical Description (300)',
                tier: 'Tier 1',
                title: '300 $c Dimensions',
                tag: '300',
                code: 'c',
                ruleId: 'ISBD_PHYS_300C',
                text: 'Dimensions punctuation.',
                tree: [
                    'If $e follows, end $c with " + ".',
                    'If $c is semantically final, preserve its data-dependent ending and do not manufacture a period.'
                ],
                examples: [
                    { before: '24 cm', after: '24 cm + 1 booklet.' },
                    { before: '; 23 cm', after: '23 cm' },
                    { before: '; 28 cm', after: '28 cm' }
                ]
            },
            {
                id: 'tg-300-e-tier1',
                module: 'Physical Description (300)',
                tier: 'Tier 1',
                title: '300 $e Accompanying material',
                tag: '300',
                code: 'e',
                ruleId: 'ISBD_PHYS_300E',
                text: 'Accompanying material uses plus as the joining separator.',
                tree: [
                    'Use plus separator from the preceding subfield (typically 300$c).',
                    'If $e is final, preserve its data-dependent ending and do not manufacture a period.',
                    'Do not double-insert "+" if already present.'
                ],
                examples: [
                    { before: '+ 1 booklet', after: '1 booklet' }
                ]
            },
            {
                id: 'tg-300-full-tier2',
                module: 'Physical Description (300)',
                tier: 'Tier 2',
                title: '300 full string check',
                tag: '300',
                code: 'a',
                ruleId: 'ISBD_PHYS_300A_HAS_B',
                text: 'Check the full extent + details + dimensions string.',
                tree: [
                    'Presentation order is extent : other details ; dimensions + accompanying material, regardless of UI entry order.',
                    'Keep spacing around ":" ";" and "+".',
                    'Do not manufacture a general final period; preserve valid abbreviation or parenthetical endings.'
                ],
                examples: [
                    { before: '300 $e 1 booklet $c 23 cm $b ill $a xii, 180 p', after: 'xii, 180 p : ill ; 23 cm + 1 booklet' }
                ]
            },
            {
                id: 'tg-250-a-tier1',
                module: 'Edition (250)',
                tier: 'Tier 1',
                title: '250 $a Edition statement',
                tag: '250',
                code: 'a',
                ruleId: 'ISBD_EDITION_250A_001',
                text: 'Edition statements end with ".".',
                tree: [
                    'Add a terminal period if none is present.'
                ],
                examples: [
                    { before: '2nd ed', after: '2nd ed.' }
                ]
            },
            {
                id: 'tg-250-b-tier1',
                module: 'Edition (250)',
                tier: 'Tier 1',
                title: '250 $b Edition remainder',
                tag: '250',
                code: 'b',
                ruleId: 'ISBD_EDITION_250B_001',
                text: 'Edition remainder commonly follows with comma-space and ends with a period.',
                tree: [
                    'If $a precedes, prefix $b with ", ".',
                    'End final edition statement with ".".',
                    'Do not double-insert commas or periods.'
                ],
                examples: [
                    { before: 'rev. and expanded', after: ', rev. and expanded.' }
                ]
            },
            {
                id: 'tg-254-a-tier2',
                module: 'Other Descriptive Fields',
                tier: 'Tier 2',
                title: '254 $a Musical presentation',
                tag: '254',
                code: 'a',
                ruleId: 'ISBD_MUSICAL_254A_001',
                text: 'Musical presentation statements are usually treated like short notes.',
                tree: [
                    'When local policy allows, end with a terminal period.',
                    'Keep wording and qualifiers as entered.'
                ],
                examples: [
                    { before: 'Miniature score', after: 'Miniature score.' }
                ]
            },
            {
                id: 'tg-255-tier2',
                module: 'Other Descriptive Fields',
                tier: 'Tier 2',
                title: '255 cartographic data',
                tag: '255',
                code: 'a',
                ruleId: 'ISBD_CARTO_255_HANDSOFF_001',
                text: 'Cartographic mathematical data is format-specific; avoid automatic internal punctuation changes.',
                tree: [
                    'Do not normalize internal punctuation in 255 automatically.',
                    'Review manually according to cartographic cataloging practice.'
                ],
                examples: [
                    { before: 'Scale 1:24,000', after: 'Scale 1:24,000' }
                ]
            },
            {
                id: 'tg-340-tier2',
                module: 'Other Descriptive Fields',
                tier: 'Tier 2',
                title: '340 physical medium',
                tag: '340',
                code: 'a',
                ruleId: 'ISBD_PHYSICAL_MEDIUM_HANDSOFF',
                text: '340 is treated as hands-off to avoid risky normalization.',
                tree: [
                    'Do not auto-ISBD-punctuate 340 subfields.',
                    'Use local/profile-specific review for this field.'
                ],
                examples: [
                    { before: 'paper', after: 'paper' }
                ]
            },
            {
                id: 'tg-336-338-tier2',
                module: 'Other Descriptive Fields',
                tier: 'Tier 2',
                title: '336/337/338 RDA content/media/carrier',
                tag: '336',
                code: 'a',
                ruleId: 'ISBD_NON_ISBD_HANDSOFF',
                text: 'These are not ISBD punctuation targets in this plugin baseline.',
                tree: [
                    'Do not add terminal punctuation by default.',
                    'Treat these as controlled vocabulary/coded-text fields.'
                ],
                examples: [
                    { before: 'text', after: 'text' }
                ]
            },
            {
                id: 'tg-490-a-tier2',
                module: 'Series (440/490/8xx)',
                tier: 'Tier 2',
                title: '490 $a Series statement',
                tag: '490',
                code: 'a',
                ruleId: 'ISBD_SERIES_490A',
                text: 'Series punctuation with numbering.',
                tree: [
                    'If related $x exists, end $a with a comma; if related $v exists without $x, end $a with " ; ".',
                    'Do not manufacture final punctuation in field 490.'
                ],
                examples: [
                    { before: 'Cambridge studies', after: 'Cambridge studies ;' }
                ]
            },
            {
                id: 'tg-8xx-hands-off-tier2',
                module: 'Series (440/490/8xx)',
                tier: 'Tier 2',
                title: '8xx controlled series access points',
                tag: '830',
                code: 'a',
                ruleId: 'ISBD_HEADING_HANDSOFF_001',
                text: '8xx fields are access points; do not force ISBD terminal punctuation.',
                tree: [
                    'Treat 8xx like other heading/access-point fields.',
                    'Avoid adding final periods unless explicitly part of established heading form.'
                ],
                examples: [
                    { before: 'Cambridge studies in cataloging', after: 'Cambridge studies in cataloging' }
                ]
            },
            {
                id: 'tg-6xx-tier2',
                module: 'Subjects (6xx)',
                tier: 'Tier 2',
                title: '6xx subdivisions',
                tag: '650',
                code: 'a',
                ruleId: 'ISBD_SUBJECT_HANDSOFF',
                text: 'Subject headings should keep subdivisions distinct (x/y/z/v) without forced terminal punctuation.',
                tree: [
                    'Keep topical, chronological, geographic, and form subdivisions separate.',
                    'Avoid merging multiple unrelated subjects into one heading.',
                    'Do not force a terminal period for heading fields.'
                ],
                examples: [
                    { before: 'Women', after: 'Women -- History -- 20th century -- United States' },
                    { before: 'Children -- Books and reading', after: 'Children -- Books and reading -- Bibliography' }
                ]
            },
            {
                id: 'tg-100-a-tier1',
                module: 'Main Entry Names (1xx)',
                tier: 'Tier 1',
                title: '100 $a Personal name heading',
                tag: '100',
                code: 'a',
                ruleId: 'ISBD_HEADING_HANDSOFF_001',
                text: 'Personal name main entry should use inverted form with comma-space and usually no terminal punctuation.',
                tree: [
                    'Use surname first, then comma-space, then forename/initials (e.g., "Fitzgerald, F. Scott").',
                    'If multiple name parts are present with no comma, add comma-space after the surname.',
                    'Do not add a terminal period unless it is part of initials.'
                ],
                examples: [
                    { before: 'F. Scott Fitzgerald', after: 'Fitzgerald, F. Scott' },
                    { before: 'Fitzgerald,F. Scott', after: 'Fitzgerald, F. Scott' }
                ]
            },
            {
                id: 'tg-110-a-tier1',
                module: 'Main Entry Names (1xx)',
                tier: 'Tier 1',
                title: '110 $a Corporate name heading',
                tag: '110',
                code: 'a',
                ruleId: 'ISBD_HEADING_HANDSOFF_001',
                text: 'Corporate headings are access points; avoid forcing terminal punctuation.',
                tree: [
                    'Maintain authorized heading form.',
                    'Do not force a final period for heading fields.'
                ],
                examples: [
                    { before: 'International Council of Museums', after: 'International Council of Museums' }
                ]
            },
            {
                id: 'tg-111-a-tier1',
                module: 'Main Entry Names (1xx)',
                tier: 'Tier 1',
                title: '111 $a Meeting name heading',
                tag: '111',
                code: 'a',
                ruleId: 'ISBD_HEADING_HANDSOFF_001',
                text: 'Meeting headings are access points; avoid forcing terminal punctuation.',
                tree: [
                    'Maintain authorized heading form.',
                    'Do not force a final period for heading fields.'
                ],
                examples: [
                    { before: 'Symposium on Cataloging', after: 'Symposium on Cataloging' }
                ]
            },
            {
                id: 'tg-700-a-tier2',
                module: 'Added Entries (7xx)',
                tier: 'Tier 2',
                title: '700 $a Added personal name',
                tag: '700',
                code: 'a',
                ruleId: 'ISBD_HEADING_HANDSOFF_001',
                text: 'Added personal name headings follow the same comma-space and no-forced-period pattern as 100$a.',
                tree: [
                    'Use surname, forename/initials form.',
                    'Avoid forcing a final period for heading fields.'
                ],
                examples: [
                    { before: 'Achebe Chinua', after: 'Achebe, Chinua' }
                ]
            },
            {
                id: 'tg-710-a-tier2',
                module: 'Added Entries (7xx)',
                tier: 'Tier 2',
                title: '710 $a Added corporate name',
                tag: '710',
                code: 'a',
                ruleId: 'ISBD_HEADING_HANDSOFF_001',
                text: 'Added corporate headings are access points; avoid forcing terminal punctuation.',
                tree: [
                    'Maintain authorized heading form.',
                    'Avoid forcing a final period for heading fields.'
                ],
                examples: [
                    { before: 'United Nations', after: 'United Nations' }
                ]
            },
            {
                id: 'tg-711-a-tier2',
                module: 'Added Entries (7xx)',
                tier: 'Tier 2',
                title: '711 $a Added meeting name',
                tag: '711',
                code: 'a',
                ruleId: 'ISBD_HEADING_HANDSOFF_001',
                text: 'Added meeting headings are access points; avoid forcing terminal punctuation.',
                tree: [
                    'Maintain authorized heading form.',
                    'Avoid forcing a final period for heading fields.'
                ],
                examples: [
                    { before: 'Annual Conference on Metadata', after: 'Annual Conference on Metadata' }
                ]
            },
            {
                id: 'tg-notes-tier2',
                module: 'Notes (5xx)',
                tier: 'Tier 2',
                title: '5xx notes',
                tag: '500',
                code: 'a',
                ruleId: 'ISBD_NOTES_500A_001',
                text: 'Notes usually end with ".".',
                tree: [
                    'Add terminal period to note statements.',
                    'Exclude complex note patterns (e.g., 505/533/534) from automatic normalization.'
                ],
                examples: [
                    { before: 'Includes bibliographical references', after: 'Includes bibliographical references.' }
                ]
            },
            {
                id: 'tg-notes-complex-tier3',
                module: 'Notes (5xx)',
                tier: 'Tier 3',
                title: '505/533/534 complex notes',
                tag: '505',
                code: 'a',
                ruleId: 'ISBD_NOTES_COMPLEX_HANDSOFF',
                text: 'Structured contents/reproduction notes are treated as hands-off to avoid breaking structure.',
                tree: [
                    'Do not auto-normalize internal punctuation for 505.',
                    'Do not auto-normalize prescribed punctuation patterns in 533/534.'
                ],
                examples: [
                    { before: 'pt. 1. Origins -- pt. 2. Methods', after: 'pt. 1. Origins -- pt. 2. Methods' }
                ]
            },
            {
                id: 'tg-identifiers-tier2',
                module: 'Identifiers & Access',
                tier: 'Tier 2',
                title: '020/022 identifiers',
                tag: '020',
                code: 'a',
                ruleId: 'ISBD_STDNUM_NO_PUNCT_001',
                text: 'Standard number fields should not be auto-punctuated.',
                tree: [
                    'Do not add periods/colons/commas to identifiers.',
                    'If trailing punctuation exists, remove it.'
                ],
                examples: [
                    { before: '9781234567890.', after: '9781234567890' }
                ]
            },
            {
                id: 'tg-041-tier2',
                module: 'Identifiers & Access',
                tier: 'Tier 2',
                title: '041 language code',
                tag: '041',
                code: 'a',
                ruleId: 'ISBD_LANG_041_HANDSOFF_001',
                text: '041 language code subfields are coded data; keep punctuation untouched.',
                tree: [
                    'Do not add punctuation in 041 subfields.',
                    'Keep language codes exactly as entered.'
                ],
                examples: [
                    { before: 'eng', after: 'eng' }
                ]
            },
            {
                id: 'tg-856-tier2',
                module: 'Identifiers & Access',
                tier: 'Tier 2',
                title: '856 electronic access',
                tag: '856',
                code: 'u',
                ruleId: 'ISBD_ELEC_ACCESS_HANDSOFF',
                text: 'Do not auto-punctuate 856; punctuation can break URLs and access strings.',
                tree: [
                    'Keep URLs and link text untouched.',
                    'If a display period is needed, handle it in OPAC/template display logic.'
                ],
                examples: [
                    { before: 'https://example.org/resource?id=1', after: 'https://example.org/resource?id=1' }
                ]
            },
            {
                id: 'tg-judgment-tier3',
                module: 'Title & Statement (245/246)',
                tier: 'Tier 3',
                title: 'Integrated title vs. responsibility',
                tag: '',
                code: '',
                text: 'Decide when names are part of the title proper.',
                tree: [
                    'If the name is integral to the title as found, keep it in $a.',
                    'If it is clearly a responsibility statement, move to $c.'
                ],
                examples: [
                    { before: 'Jane Fonda\'s workout book', after: 'Keep as title proper in $a.' },
                    { before: 'Gypsy politics / edited by Thomas Acton', after: 'Move names to $c.' }
                ]
            }
        ];

        return steps.map(step => {
            const rule = step.ruleId ? rulesById.get(step.ruleId) : null;
            const example = (step.examples && step.examples[0]) || { before: '', after: '' };
            return {
                key: step.id,
                title: step.title,
                tag: step.tag || '',
                code: step.code || '',
                occurrence: '',
                module: step.module || '',
                alternateTags: step.alternateTags || [],
                ruleId: step.ruleId || (rule ? rule.id : ''),
                rule,
                text: step.text || '',
                tree: step.tree || [],
                examples: step.examples || [],
                example_raw: example.before || '',
                example_expected: example.after || ''
            };
        });
    }

    function buildGuideStepSets(settings, state) {
        const primary = buildDecisionGuideSteps(settings, state);
        const secondary = [];
        primary.forEach(step => {
            if (step.tag && step.code) {
                const $field = findFieldElement(step.tag, step.code, step.occurrence || '');
                step.hasField = $field.length > 0;
                step.tab = step.hasField ? (findFieldTabId($field) || '') : '';
            } else {
                step.hasField = false;
                step.tab = '';
            }
        });
        return {
            primary: prioritizeGuideSteps(primary, state),
            secondary: prioritizeGuideSteps(secondary, state)
        };
    }

    function indicatorMatch(value, ruleValue) {
        if (ruleValue === undefined || ruleValue === null || ruleValue === '') return true;
        if (ruleValue === '*') return true;
        if (Array.isArray(ruleValue)) return ruleValue.includes(value);
        return ruleValue === value;
    }

    function ruleAppliesToField(rule, field, subfieldCode) {
        if (!rule || !field) return false;
        if (rule.tag && rule.tag !== field.tag) return false;
        if (rule.tag_pattern && !safeRegexTest(rule.tag_pattern, field.tag, `Rule ${rule.id || 'unknown'} tag_pattern`)) return false;
        if (!indicatorMatch(field.ind1 || '', rule.ind1)) return false;
        if (!indicatorMatch(field.ind2 || '', rule.ind2)) return false;
        if (rule.subfields && Array.isArray(rule.subfields)) {
            return rule.subfields.map(code => code.toLowerCase()).includes((subfieldCode || '').toLowerCase());
        }
        if (rule.subfield_pattern) {
            return safeRegexTest(rule.subfield_pattern, subfieldCode || '', `Rule ${rule.id || 'unknown'} subfield_pattern`);
        }
        return true;
    }

    function getGuideProgressKey(settings) {
        const user = (settings && settings.currentUserId ? String(settings.currentUserId) : '').trim() || 'anonymous';
        const framework = (settings && settings.frameworkCode ? String(settings.frameworkCode) : '').trim() || 'default';
        return `isbdGuideProgress:${user}:${framework}`;
    }

    function loadGuideProgress(steps, settings) {
        const key = getGuideProgressKey(settings);
        const signature = steps.map(step => step.key).join('|');
        let progress = { completed: {}, skipped: {}, currentIndex: 0, signature };
        try {
            const stored = (window.localStorage && window.localStorage.getItem(key))
                || (window.sessionStorage && window.sessionStorage.getItem(key))
                || '';
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed && parsed.completed) {
                    steps.forEach(step => {
                        if (parsed.completed[step.key]) {
                            progress.completed[step.key] = true;
                        }
                        if (parsed.skipped && parsed.skipped[step.key]) {
                            progress.skipped[step.key] = true;
                        }
                    });

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
        if (global.ISBDTrainingWorkspace && typeof global.ISBDTrainingWorkspace.open === 'function') {
            try {
                state.guideActive = true;
                state.guideRefresh = null;
                state.guideCurrentStep = null;
                global.ISBDTrainingWorkspace.open(settings, state, {
                    onClose: () => updateGuideToggleButton()
                });
                updateGuideToggleButton();
            } catch (error) {
                state.guideActive = false;
                updateGuideToggleButton();
                toast('error', 'Unable to open the training workspace. See console for details.');
                console.error('[ISBD Assistant] Training workspace error:', error);
            }
            return;
        }
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
        buildPluginUrl
    };
    global.ISBDIntellisenseUI = { init: initUI };
})(window, window.jQuery);
