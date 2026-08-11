'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.join(
    __dirname, '..', 'Koha/Plugin/Cataloging/AutoPunctuation/js/marc_intellisense_ui.js'
), 'utf8');

assert(!source.includes('AI returned no cataloging suggestions.'),
    'false generic no-suggestions toast was removed');
assert(source.includes('Cataloguing suggestions were recovered from non-structured AI output.'),
    'degraded recovery has a state-aware toast');
assert(source.includes('The AI response could not be safely parsed into cataloguing suggestions.'),
    'malformed response has a distinct toast');
assert(source.includes('AI suggestions are available, but authority verification is temporarily unavailable.'),
    'authority outage preserves available AI suggestions');
assert(source.includes('Retry authority verification'),
    'authority verification can be retried without AI regeneration');
assert(source.includes('AI rationale:'), 'cataloguing UI labels projected rationale truthfully');
assert(source.includes('LCSH verified'), 'verified LCSH state is rendered');
assert(source.includes('Authorized heading found'), 'variant LCSH state is rendered');
assert(source.includes('Possible authority match'), 'close LCSH state is rendered');

console.log('ai_cataloging_ui_regression: ok');
