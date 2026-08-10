'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'Koha/Plugin/Cataloging/AutoPunctuation/js/api_client.js'), 'utf8');
assert(!source.includes('api.openai.com'), 'browser bundle must not call OpenAI');
assert(!source.includes('openrouter.ai'), 'browser bundle must not call OpenRouter');
assert(!/api[_-]?key/i.test(source), 'browser API client must not handle provider API keys');

let responsePayload;
let postedBody = '';
const context = {
    URL,
    URLSearchParams,
    console,
    window: {
        location: { origin: 'https://koha.example', pathname: '/cataloguing/addbiblio.pl' },
        AutoPunctuationSettings: {
            pluginClass: 'Koha::Plugin::Cataloging::AutoPunctuation',
            pluginRunPath: '/cgi-bin/koha/plugins/run.pl',
            csrfToken: 'csrf'
        }
    },
    document: {
        getElementById: () => null,
        querySelector: () => null
    },
    fetch: async (url, options) => {
        postedBody = options.body;
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify(responsePayload)
        };
    }
};
context.window.window = context.window;
context.window.document = context.document;
context.window.fetch = context.fetch;
context.window.URL = URL;
context.window.URLSearchParams = URLSearchParams;
context.window.ISBDSchemas = {
    ai_request: JSON.parse(fs.readFileSync(path.join(root, 'Koha/Plugin/Cataloging/AutoPunctuation/schema/ai_request.json'), 'utf8'))
};
vm.createContext(context);
vm.runInContext(source, context);

const base = {
    request_id: 'request-1',
    task: 'cataloging_classification',
    context_mode: 'tag_only',
    tag_context: { tag: '245', ind1: '1', ind2: '0', occurrence: 0, subfields: [{ code: 'a', value: 'Libraries' }] },
    features: { call_number_guidance: true }
};

(async () => {
    responsePayload = {
        request_id: 'request-1', task: 'cataloging_classification', schema_version: '1.0.0',
        status: 'ok', warnings: [], requires_human_review: true, findings: [],
        authority_status: 'unverified',
        candidate: { value: 'Z665', confidence: 'medium', basis: 'Title evidence' }
    };
    const response = await context.window.ISBDApiClient.aiSuggest('/cgi-bin/koha/plugins/run.pl', base);
    assert.strictEqual(response.task, base.task, 'client accepts matching explicit task');
    const form = new URLSearchParams(postedBody);
    const sent = JSON.parse(form.get('payload'));
    assert.strictEqual(sent.task, 'cataloging_classification', 'task is sent to server');
    assert.strictEqual(sent.tag_context.ind1, '1', 'indicator is sent');

    await assert.rejects(
        () => context.window.ISBDApiClient.aiSuggest('/cgi-bin/koha/plugins/run.pl', { ...base, task: '' }),
        /explicit supported AI task/
    );

    responsePayload = { ...responsePayload, task: 'subject_heading_suggestion' };
    await assert.rejects(
        () => context.window.ISBDApiClient.aiSuggest('/cgi-bin/koha/plugins/run.pl', base),
        /task mismatch/
    );
    console.log('ai_client_contract: ok');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
