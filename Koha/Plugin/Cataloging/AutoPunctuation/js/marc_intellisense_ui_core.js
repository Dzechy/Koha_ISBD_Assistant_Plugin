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
            ruleDependencies: new Map(),
            statementCaseTimers: new Map(),
            aiSubjectHistory: {},
            guideCurrentStep: null,
            guideRefresh: null,
            lastFocusedField: null,
            aiSuggestions: { classification: '', subjects: [], confidence: null, rawText: '', errors: [] },
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
