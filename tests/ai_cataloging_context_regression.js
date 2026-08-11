'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(
    __dirname, '..', 'Koha/Plugin/Cataloging/AutoPunctuation/js/marc_intellisense_ui.js'
), 'utf8');
const context = {
    window: {
        jQuery: function() {},
        performance: { now: () => 10 }
    },
    console,
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context);

const hooks = context.window.ISBDIntellisenseTestHooks;
assert(hooks, 'cataloguing UI test hooks are available');

const prioritized = hooks.prioritizeCatalogingFields([
    { tag: '999', subfields: [{ code: 'a', value: 'local data' }] },
    { tag: '520', subfields: [{ code: 'a', value: 'A local oral history.' }] },
    { tag: '100', subfields: [{ code: 'a', value: 'Okafor, Ada' }] }
], 30);
assert.deepStrictEqual(Array.from(prioritized, field => field.tag), ['100', '520', '999'],
    'cataloguing evidence is ranked by task relevance, not DOM order');

const creatorContext = hooks.buildCatalogingTagContext(prioritized[0]);
assert.strictEqual(creatorContext.tag, '100', 'non-245 evidence can be the primary context');
assert.strictEqual(hooks.isMeaningfulCatalogingValue('Okafor, Ada'), true,
    'sparse creator evidence remains meaningful');
assert.strictEqual(hooks.isMeaningfulCatalogingValue('[title]'), false,
    'placeholder text is not treated as evidence');
assert.strictEqual(hooks.sanitizeAiClassificationSuggestion('QA76.73.J38 S65 2020'),
    'QA76.73.J38 S65 2020', 'complete LC call numbers survive browser projection');
assert.strictEqual(hooks.sanitizeAiClassificationSuggestion('QA76 artificial intelligence'), '',
    'classification prose is rejected instead of being treated as a local suffix');

const inputHandlerStart = source.indexOf("$(document).on('input.isbd'");
const inputHandlerEnd = source.indexOf("$(document).on('keydown.isbd'", inputHandlerStart);
const inputHandler = source.slice(inputHandlerStart, inputHandlerEnd);
assert(inputHandler.includes('scheduleFieldValidation('),
    'typing schedules bounded validation work');
assert(!inputHandler.includes('runFieldValidation(this'),
    'typing does not synchronously run full field validation');
assert(inputHandler.includes('scheduleAiPanelRefresh('),
    'AI panel projection refresh is debounced while typing');
assert(source.includes('sidePanelFingerprint'),
    'unchanged side-panel state skips a complete DOM rebuild');
assert(source.includes("recordPerformance(state, 'input_handler'"),
    'input performance is instrumented');
assert(!source.includes('245$a is required for AI cataloging guidance.'),
    'cataloguing UI no longer hard-gates suggestions on 245$a');
const catalogingProjectionStart = source.indexOf('function updateAiCatalogingContext(');
const catalogingProjectionEnd = source.indexOf('function getAiCatalogingSelectionState(', catalogingProjectionStart);
const catalogingProjection = source.slice(catalogingProjectionStart, catalogingProjectionEnd);
assert(catalogingProjection.includes('const titleInfo = getTitleWithSubtitle();'),
    'AI cataloguing projection declares titleInfo before returning it');

console.log('ai_cataloging_context_regression: ok');
