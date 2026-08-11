/*
 * Browser transport for the Koha ISBD Assistant.
 * Provider credentials, prompts, parsing, and provider calls are server-only.
 */
(function(global) {
    'use strict';

    const TASKS = new Set([
        'punctuation_explanation',
        'cataloging_classification',
        'subject_heading_suggestion',
        'cataloging_review',
        'training_tutor'
    ]);
    const STATUSES = new Set(['ok', 'insufficient_evidence', 'incomplete']);

    function validateSchema(schema, data, path, errors) {
        if (!schema || typeof schema !== 'object') return;
        const currentPath = path || '$';
        if (schema.type === 'object') {
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                errors.push(`${currentPath} should be object`);
                return;
            }
            (schema.required || []).forEach(key => {
                if (!(key in data)) errors.push(`${currentPath} missing ${key}`);
            });
            Object.keys(schema.properties || {}).forEach(key => {
                if (key in data) validateSchema(schema.properties[key], data[key], `${currentPath}.${key}`, errors);
            });
            if (schema.additionalProperties === false) {
                Object.keys(data).forEach(key => {
                    if (!(key in (schema.properties || {}))) errors.push(`${currentPath} has unexpected property ${key}`);
                });
            }
        } else if (schema.type === 'array') {
            if (!Array.isArray(data)) {
                errors.push(`${currentPath} should be array`);
                return;
            }
            if (Number.isFinite(schema.maxItems) && data.length > schema.maxItems) {
                errors.push(`${currentPath} has too many items`);
            }
            data.forEach((item, index) => validateSchema(schema.items, item, `${currentPath}[${index}]`, errors));
        } else if (schema.type === 'string') {
            if (typeof data !== 'string') errors.push(`${currentPath} should be string`);
            if (Array.isArray(schema.enum) && !schema.enum.includes(data)) errors.push(`${currentPath} has invalid value`);
            if (typeof data === 'string' && Number.isFinite(schema.maxLength) && data.length > schema.maxLength) {
                errors.push(`${currentPath} is too long`);
            }
        } else if (schema.type === 'number' && typeof data !== 'number') {
            errors.push(`${currentPath} should be number`);
        } else if (schema.type === 'boolean' && typeof data !== 'boolean') {
            errors.push(`${currentPath} should be boolean`);
        }
    }

    function validateAgainstSchema(name, data) {
        const schema = (global.ISBDSchemas || {})[name];
        const errors = [];
        if (schema) validateSchema(schema, data, '$', errors);
        return errors;
    }

    function csrfToken() {
        const settings = global.AutoPunctuationSettings || {};
        const candidates = [
            settings.csrfToken,
            settings.csrf_token,
            (document.getElementById('csrf_token') || {}).value,
            ((document.querySelector('input[name="csrf_token"]') || {}).value),
            ((document.querySelector('meta[name="csrf-token"]') || {}).content)
        ];
        const value = candidates.find(candidate => candidate !== undefined && candidate !== null && String(candidate).trim());
        return value ? String(value).replace(/[\r\n]/g, '').trim() : '';
    }

    function normalizeOccurrence(value) {
        const parsed = Number.parseInt(value, 10);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    function normalizeField(field, maxSubfields) {
        const source = field && typeof field === 'object' ? field : {};
        return {
            ...source,
            occurrence: normalizeOccurrence(source.occurrence),
            subfields: (Array.isArray(source.subfields) ? source.subfields : [])
                .slice(0, maxSubfields)
                .filter(subfield => subfield && typeof subfield === 'object')
                .map(subfield => ({
                    code: String(subfield.code || '').slice(0, 1),
                    value: subfield.value === undefined || subfield.value === null ? '' : String(subfield.value)
                }))
        };
    }

    function normalizeAiRequest(payload) {
        if (!payload || typeof payload !== 'object') return {};
        const normalized = {
            ...payload,
            task: String(payload.task || ''),
            context_mode: String(payload.context_mode || 'tag_only'),
            tag_context: normalizeField(payload.tag_context, 20),
            features: {
                punctuation_explain: !!(payload.features && payload.features.punctuation_explain),
                subject_guidance: !!(payload.features && payload.features.subject_guidance),
                call_number_guidance: !!(payload.features && payload.features.call_number_guidance)
            }
        };
        if (payload.record_context && Array.isArray(payload.record_context.fields)) {
            normalized.record_context = {
                fields: payload.record_context.fields.slice(0, 30).map(field => normalizeField(field, 30))
            };
        }
        return normalized;
    }

    function pluginUrl(pluginPath, method) {
        const settings = global.AutoPunctuationSettings || {};
        const raw = String(pluginPath || settings.pluginPath || settings.pluginRunPath || '/cgi-bin/koha/plugins/run.pl');
        const url = new URL(raw, global.location && global.location.origin ? global.location.origin : 'http://localhost');
        if (!url.searchParams.get('class') && settings.pluginClass) url.searchParams.set('class', settings.pluginClass);
        if (!url.searchParams.get('class')) throw new Error('Plugin class is required.');
        url.searchParams.set('method', method);
        url.searchParams.set('op', 'cud-plugin_api');
        return `${url.pathname}?${url.searchParams.toString()}`;
    }

    function looksLikeLoginHtml(text) {
        const value = String(text || '').toLowerCase();
        return value.includes('name="login_userid"') || value.includes('id="loginform"') || value.includes('koha login');
    }

    async function postJson(url, payload, options) {
        const token = csrfToken();
        const bodyPayload = payload && typeof payload === 'object' ? { ...payload } : {};
        if (token) bodyPayload.csrf_token = token;
        const queryIndex = url.indexOf('?');
        const form = new URLSearchParams(queryIndex >= 0 ? url.slice(queryIndex + 1) : '');
        form.set('payload', JSON.stringify(bodyPayload));
        if (token) form.set('csrf_token', token);
        const response = await fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            signal: options && options.signal,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Accept': 'application/json',
                ...(token ? { 'X-CSRF-Token': token, 'CSRF-TOKEN': token } : {})
            },
            body: form.toString()
        });
        const text = await response.text();
        if (looksLikeLoginHtml(text)) throw new Error('Koha session expired. Sign in and retry.');
        let data;
        try {
            data = JSON.parse(text);
        } catch (error) {
            throw new Error(`Plugin returned a non-JSON response (HTTP ${response.status}).`);
        }
        if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
        return data;
    }

    function validateAiResponse(request, response) {
        const errors = [];
        if (!response || typeof response !== 'object' || Array.isArray(response)) return ['Response should be an object.'];
        if (response.request_id !== request.request_id) errors.push('AI response request ID mismatch.');
        if (response.task !== request.task) errors.push('AI response task mismatch.');
        if (typeof response.schema_version !== 'string') errors.push('AI response missing schema version.');
        if (!STATUSES.has(response.status)) errors.push('AI response has invalid status.');
        if (!Array.isArray(response.warnings)) errors.push('AI response warnings should be an array.');
        if (typeof response.requires_human_review !== 'boolean') errors.push('AI response missing human-review flag.');
        if (response.findings !== undefined && !Array.isArray(response.findings)) errors.push('AI response findings should be an array.');
        const confidenceValues = new Set(['high', 'medium', 'low', 'insufficient_evidence']);
        if (request.task === 'cataloging_classification') {
            if (response.status === 'ok' && (!response.candidate || typeof response.candidate !== 'object')) {
                errors.push('Classification response missing candidate.');
            }
            if (response.candidate && !confidenceValues.has(response.candidate.confidence)) {
                errors.push('Classification response has invalid confidence.');
            }
            if (response.authority_status !== 'unverified' && response.authority_status !== 'verified') {
                errors.push('Classification response has invalid authority status.');
            }
        }
        if (request.task === 'subject_heading_suggestion') {
            if (!Array.isArray(response.candidates)) errors.push('Subject response candidates should be an array.');
            (response.candidates || []).forEach(candidate => {
                if (!confidenceValues.has(candidate && candidate.confidence)) errors.push('Subject candidate has invalid confidence.');
                if (!candidate || !Array.isArray(candidate.subdivisions)) errors.push('Subject candidate subdivisions should be an array.');
            });
        }
        if (request.task === 'punctuation_explanation') {
            if (typeof response.explanation !== 'string') errors.push('Punctuation response missing explanation.');
            if (typeof response.rule_reference !== 'string') errors.push('Punctuation response missing rule reference.');
        }
        return errors;
    }

    async function aiSuggest(pluginPath, payload, options) {
        const normalized = normalizeAiRequest(payload);
        if (!TASKS.has(normalized.task)) throw new Error('An explicit supported AI task is required.');
        const requestErrors = validateAgainstSchema('ai_request', normalized);
        if (requestErrors.length) throw new Error(`Invalid request: ${requestErrors.join(', ')}`);
        const result = await postJson(pluginUrl(pluginPath, 'ai_suggest'), normalized, options);
        const responseErrors = validateAiResponse(normalized, result);
        if (responseErrors.length) throw new Error(`Invalid AI response: ${responseErrors.join(', ')}`);
        return result;
    }

    global.ISBDApiClient = {
        validateSchema: validateAgainstSchema,
        validateAiResponse,
        postJson,
        validateField: (pluginPath, payload) => postJson(pluginUrl(pluginPath, 'validate_field'), payload),
        validateRecord: (pluginPath, payload) => postJson(pluginUrl(pluginPath, 'validate_record'), payload),
        aiSuggest,
        retryAuthority: (pluginPath, payload, options) =>
            postJson(pluginUrl(pluginPath, 'ai_authority_retry'), payload, options),
        testConnection: pluginPath => postJson(pluginUrl(pluginPath, 'test_connection'), {})
    };
})(window);
