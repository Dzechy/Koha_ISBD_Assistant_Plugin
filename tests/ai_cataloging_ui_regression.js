'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.join(
    __dirname, '..', 'Koha/Plugin/Cataloging/AutoPunctuation/js/marc_intellisense_ui.js'
), 'utf8');

assert(!source.includes('AI returned no cataloging suggestions.'),
    'false generic no-suggestions toast was removed');
assert(source.includes('Cataloging suggestions were recovered from non-structured AI output.'),
    'degraded recovery has a state-aware toast');
assert(source.includes('The AI response could not be safely parsed into cataloging suggestions.'),
    'malformed response has a distinct toast');
assert(source.includes('AI suggestions are available, but authority verification is temporarily unavailable.'),
    'authority outage preserves available AI suggestions');
assert(source.includes('Retry authority verification'),
    'authority verification can be retried without AI regeneration');
assert(source.includes('AI rationale:'), 'cataloguing UI labels projected rationale truthfully');
assert(source.includes('LCSH verified'), 'verified LCSH state is rendered');
assert(source.includes('Authorized heading found'), 'variant LCSH state is rendered');
assert(source.includes('Possible authority match'), 'close LCSH state is rendered');
assert(source.includes('No safe suggestion returned'),
    'a requested classification with no candidate is described accurately');
assert(!source.includes("normalizedClassification ? 'LCCS not verified' : 'Classification not requested'"),
    'classification request state is no longer inferred from candidate presence');
assert(source.includes("requestCompleted: true"),
    'completed cataloging requests are retained independently of their results');
assert(source.includes("requested: { ...requested }"),
    'the exact requested outputs are retained with the response');
assert(source.includes("? 'not applicable'"),
    'an absent classification candidate is not assigned misleading low confidence');
assert(source.includes('Classification was requested, but no safe suggestion was returned'),
    'the completion toast distinguishes a safe empty classification response');
assert(source.includes('class="isbd-toast-stack"'),
    'notifications use a non-overlapping toast stack');
assert(source.includes('toastState.active.has(key)'),
    'duplicate visible notifications are suppressed');
assert(source.includes('Apply all fixes'),
    'the cataloging panel labels bulk mutations explicitly');
assert(source.includes('Use AI suggestion'),
    'classification copy action is no longer labeled ambiguously');
assert(source.includes('About Koha ISBD Cataloging Assistant'),
    'the About dialog uses a readable product name');

console.log('ai_cataloging_ui_regression: ok');
