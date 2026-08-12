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
assert(source.includes('The AI response is displayed, but it could not be parsed into applicable cataloging suggestions.'),
    'malformed response remains visible and has a distinct toast');
assert(source.includes('AI suggestions are available, but authority verification is temporarily unavailable.'),
    'authority outage preserves available AI suggestions');
assert(source.includes('Retry authority verification'),
    'authority verification can be retried without AI regeneration');
assert(source.includes('AI rationale:'), 'cataloguing UI labels projected rationale truthfully');
assert(source.includes('LCSH verified'), 'verified LCSH state is rendered');
assert(source.includes('Authorized heading found'), 'variant LCSH state is rendered');
assert(source.includes('Possible authority match'), 'close LCSH state is rendered');
assert(source.includes('No usable candidate'),
    'a requested classification with no applicable candidate is described accurately');
assert(!source.includes("normalizedClassification ? 'LCCS not verified' : 'Classification not requested'"),
    'classification request state is no longer inferred from candidate presence');
assert(source.includes("requestCompleted: true"),
    'completed cataloging requests are retained independently of their results');
assert(source.includes("requested: { ...requested }"),
    'the exact requested outputs are retained with the response');
assert(source.includes("? 'not applicable'"),
    'an absent classification candidate is not assigned misleading low confidence');
assert(source.includes('AI responded without a usable classification candidate'),
    'the completion toast explains that the original empty-candidate response remains available');
assert(source.includes('assistantResponse: (result.assistant_response'),
    'cataloguing state retains bounded original assistant output');
assert(source.includes('Original AI response · no applicable candidate was extracted'),
    'the original assistant response is visibly labelled when no candidate can be applied');
assert(source.includes('.isbd-panel .body { flex: 1 1 0; min-height: 0;'),
    'cataloging assistant body is a bounded flex scroller');
assert(source.includes('scrollbar-gutter: stable') && source.includes('touch-action: auto'),
    'floating panels expose stable mouse, keyboard, and touch scrolling');
assert(source.includes('.isbd-guide-modal {') && source.includes('resize: both; overflow: hidden;'),
    'the guide uses one bounded content scroller instead of competing nested scrollers');
assert(source.includes('.isbd-ai-badge {') && source.includes('border-radius: 4px;'),
    'status badges use restrained corners instead of fully rounded pills');
assert(source.includes("bindFloatingPanelDrag($panel, 'isbdpanel')"),
    'cataloging panel uses the shared pointer drag implementation');
assert(source.includes('pointerdown.'),
    'floating panels accept touch, pen, and mouse pointer dragging');
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
