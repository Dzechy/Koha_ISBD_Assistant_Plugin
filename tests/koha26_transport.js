'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const files = [
    'Koha/Plugin/Cataloging/AutoPunctuation/js/api_client.js',
    'Koha/Plugin/Cataloging/AutoPunctuation/js/marc_intellisense_ui.js',
    'Koha/Plugin/Cataloging/AutoPunctuation/configure.tt'
];

for (const relativePath of files) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    if (!source.includes('application/x-www-form-urlencoded; charset=UTF-8')) {
        throw new Error(`${relativePath} does not use the Koha 26-compatible form transport`);
    }
    if (!source.includes("formBody.set('payload', JSON.stringify(")) {
        throw new Error(`${relativePath} does not add its plugin JSON to the payload form field`);
    }
    if (!source.includes("new URLSearchParams(queryIndex >= 0 ?")) {
        throw new Error(`${relativePath} does not copy URL dispatch parameters into the POST body`);
    }
}

const apiClient = fs.readFileSync(path.join(root, files[0]), 'utf8');
const postJsonStart = apiClient.indexOf('async function postJson(');
const postJsonEnd = apiClient.indexOf('\n    function buildEndpoint(', postJsonStart);
const postJsonSource = apiClient.slice(postJsonStart, postJsonEnd);
if (postJsonSource.includes("'Content-Type': 'application/json'")) {
    throw new Error('Plugin postJson transport regressed to application/json');
}

const configureTemplate = fs.readFileSync(path.join(root, files[2]), 'utf8');
if (!configureTemplate.includes('name="op" value="cud-save_configuration"')) {
    throw new Error('Configure POST operation must use Koha\'s cud- prefix');
}
if (configureTemplate.includes('name="op" value="save_configuration"')) {
    throw new Error('Configure POST operation uses the rejected legacy op value');
}

const intranetFiles = [
    'rules_engine.js',
    'ai_text_extract.js',
    'api_client_core.js',
    'api_client_prompt.js',
    'api_client_guardrails.js',
    'api_client_response.js',
    'api_client.js',
    'cuttersanborn_data.js',
    'cutter_sanborn.js',
    'marc_intellisense_ui_core.js',
    'marc_intellisense_ui_forms.js',
    'marc_intellisense_ui_ai.js',
    'marc_intellisense_ui_guide.js',
    'marc_intellisense_ui_events.js',
    'marc_intellisense_ui.js',
    'auto-punctuation.js'
];
const jsDirectory = path.join(root, 'Koha/Plugin/Cataloging/AutoPunctuation/js');
const intranetBundle = intranetFiles
    .map(file => fs.readFileSync(path.join(jsDirectory, file), 'utf8'))
    .join('\n');
new vm.Script(intranetBundle, { filename: 'auto-punctuation-intranet-bundle.js' });

console.log('koha26_transport: ok');
