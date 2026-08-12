#!/usr/bin/env node
'use strict';

/*
 * Rebuild the expanded v4 curriculum from the reviewed v3 core lessons plus
 * compact lesson specifications. The generated JSON remains the runtime source
 * so Koha does not need Node or a build step.
 */
const fs = require('fs');
const path = require('path');

const curriculumPath = path.resolve(__dirname, '../Koha/Plugin/Cataloging/AutoPunctuation/rules/intern_guide_v2.json');
const curriculum = JSON.parse(fs.readFileSync(curriculumPath, 'utf8'));

const lessonSpecs = {
  foundations: [
    ['sources-and-transcription', 'Sources of information and faithful transcription', 'transcription evidence',
      'Cataloguers must separate what the resource says from later interpretation.',
      'Transcribe from the prescribed source, retain evidence, and record uncertainty instead of silently inventing data.',
      'A title page supplies the title; an external website may help verify identity but does not silently replace the source.',
      ['Which action preserves the evidence chain?', 'Transcribe the prescribed source and record uncertainty', ['Replace unclear wording from memory', 'Copy a retailer description without review', 'Normalize every unusual form silently']],
      ['When the preferred source is ambiguous, what should happen?', 'Escalate the judgment and document the evidence', ['Let punctuation software choose the title', 'Delete the ambiguous element', 'Assume the most common wording']]],
    ['decisions-and-notes', 'Cataloguer decisions and defensible notes', 'professional judgment',
      'A high-quality record makes consequential decisions traceable.',
      'Distinguish objective transcription, rule-governed transformation, and local professional judgment.',
      'A deterministic colon can be suggested automatically; choosing which conflicting date is authoritative needs review.',
      ['Which task most clearly requires cataloguer judgment?', 'Choosing between conflicting publication dates', ['Removing a duplicated generated point', 'Showing the MARC tag', 'Counting present subfields']],
      ['What makes a cataloguing decision defensible?', 'Evidence, an applicable rule, and a recorded rationale', ['A confident interface badge', 'The shortest possible record', 'An unverified AI answer']]]
  ],
  'marc-structure': [
    ['repeatability-and-order', 'Repeatability, occurrence, and subfield order', 'MARC field structure',
      'Repeated fields and repeated subfields carry meaning that must not be flattened.',
      'Preserve occurrence identity and evaluate ordered subfields within the correct field instance.',
      'Two 264 fields can describe publication and copyright; their second indicators keep the functions distinct.',
      ['What must a field-level fix preserve?', 'The exact field occurrence and subfield order', ['Only the visible text', 'The first matching tag in the record', 'Alphabetical subfield order']],
      ['Why is tag-only targeting unsafe?', 'A record may contain multiple occurrences with different functions', ['MARC tags are optional', 'Indicators are always blank', 'Subfields cannot repeat']]],
    ['indicators-and-nonfiling', 'Indicators and nonfiling characters', 'indicator semantics',
      'Indicators are data, not decoration; changing one may change access or display behavior.',
      'Interpret both indicator positions from the field definition and count nonfiling characters deliberately.',
      '245 14 can signal an added title entry and four nonfiling characters for “The ”.',
      ['In 245, what can the second indicator represent?', 'The number of nonfiling characters', ['The number of authors', 'The ISBD area number', 'The subfield count']],
      ['Before changing an indicator, what evidence is required?', 'The tag definition and the bibliographic content', ['The panel width', 'A color-coded badge', 'The last record edited']]]
  ],
  'isbd-areas': [
    ['area-sequence', 'Descriptive areas and element sequence', 'ISBD area sequence',
      'Area boundaries organize a description and explain why separators differ.',
      'Identify the descriptive area and element roles before selecting prescribed punctuation.',
      'Title and responsibility belong to Area 1; edition belongs to Area 2; publication belongs to Area 4.',
      ['Which area contains edition information?', 'Area 2', ['Area 1', 'Area 5', 'Area 8']],
      ['What should be identified before a separator is applied?', 'The bibliographic roles on both sides of the boundary', ['The button color', 'The longest subfield', 'The current panel position']]],
    ['punctuation-provenance', 'Punctuation provenance and safe normalization', 'punctuation provenance',
      'Identical characters can be transcribed, intrinsic, prescribed, or generated.',
      'Track where punctuation came from before removing or replacing it.',
      'The point in “ed.” is intrinsic; a following comma can still be prescribed for the next edition element.',
      ['Why should provenance be tracked?', 'It prevents meaningful punctuation from being removed as generated noise', ['It makes every field shorter', 'It removes the need for rules', 'It converts MARC to plain text']],
      ['Which point is intrinsic rather than a field terminator?', 'The point in the abbreviation “ed.”', ['A generated duplicate final point', 'A colon introducing 245$b', 'A slash introducing 245$c']]]
  ],
  'title-responsibility': [
    ['parallel-and-variant-titles', 'Parallel, other, and variant titles', 'title relationships',
      'Different title roles use different fields and boundaries and should not be collapsed.',
      'Determine whether wording is parallel title, other title information, or a variant access title.',
      '245$b continues the title statement; 246 supplies a variant title access point under its own indicator rules.',
      ['Where is a variant title access point commonly recorded?', '246', ['250', '300', '500']],
      ['Why should 245$b and 246 not be treated as interchangeable?', 'They serve descriptive and access functions differently', ['They always contain identical text', '246 is a punctuation-only field', '245 has no indicators']]],
    ['compound-responsibility', 'Compound responsibility statements', 'responsibility relationships',
      'Multiple names and functions must remain faithful to the source while the statement ends once.',
      'Identify one or more responsibility groups, preserve wording, and apply only supported separators.',
      '245$c by Amina Yusuf ; illustrations by Ken Obi.',
      ['What should software avoid doing in a responsibility statement?', 'Rewriting names or assigning unsupported roles', ['Detecting duplicate final punctuation', 'Showing the source value', 'Flagging a missing boundary']],
      ['How should a complete responsibility statement end?', 'With one appropriate terminal mark', ['With a point after every name', 'Without regard to following fields', 'With a colon before each role']]]
  ],
  'edition-statements': [
    ['edition-responsibility', 'Responsibility relating to an edition', 'edition responsibility',
      'Responsibility for a particular edition is not necessarily responsibility for the whole work.',
      'Keep edition wording and its related responsibility in their correct 250 subfields.',
      '250 ## $a 3rd ed. / $b revised by Ada Okafor.',
      ['Which subfield can carry responsibility relating to an edition?', '250$b', ['245$b', '300$c', '020$q']],
      ['What boundary introduces edition responsibility?', 'A slash relationship after the edition statement', ['A colon for dimensions', 'An equals sign for ISBN', 'No boundary is ever used']]],
    ['parallel-edition-statements', 'Parallel and additional edition statements', 'complex edition relationships',
      'Complex edition statements require both punctuation knowledge and careful source interpretation.',
      'Preserve parallel wording and distinguish an additional edition statement from related responsibility.',
      'The relationship—not the mere presence of 250$b—determines whether a comma, equals sign, or slash is appropriate.',
      ['What determines punctuation before a complex 250$b?', 'The bibliographic relationship represented by the subfield', ['The subfield length', 'The current UI theme', 'A universal comma rule']],
      ['When should automation stop and ask for review?', 'When the relationship of the edition wording is ambiguous', ['Whenever 250 exists', 'Only when the panel is minimized', 'After deleting the source wording']]]
  ],
  publication: [
    ['repeated-places-agents', 'Repeated places and publication agents', 'repeated publication elements',
      'Publication statements can repeat places and agents without losing their pairing.',
      'Read the ordered $a and $b sequence and preserve each place-to-agent relationship.',
      '264 #1 $a Lagos : $b Spectrum ; $a Accra : $b Horizon, $c 2026.',
      ['What must be preserved in repeated 264 elements?', 'The order and pairing of places and agents', ['Only the last publisher', 'Alphabetical place order', 'A single merged subfield']],
      ['Why can flattening repeated 264 subfields be harmful?', 'It destroys which agent is associated with which place', ['It changes the panel color', 'It adds an indicator automatically', 'It converts dates to notes']]],
    ['production-distribution-copyright', 'Production, distribution, and copyright functions', '264 function indicators',
      'The same 264 tag can encode different functions with different punctuation expectations.',
      'Use indicator 2 to distinguish production, publication, distribution, manufacture, and copyright.',
      '264 #1 is publication, 264 #2 distribution, 264 #3 manufacture, and 264 #4 copyright.',
      ['Which evidence identifies the function of a 264 field?', 'The second indicator', ['The field width', 'The first letter of $b', 'The number of spaces']],
      ['Why is 264 #4 handled conservatively?', 'A copyright notice is not an ordinary publication statement', ['It has no date', 'It is always invalid', 'It belongs to Area 1']]]
  ],
  'physical-description': [
    ['accompanying-material', 'Accompanying material and 300$e', 'accompanying material',
      'Accompanying material extends the carrier description and has its own boundary.',
      'Identify extent, details, dimensions, and accompanying material before applying separators.',
      '300 ## $a 1 volume : $b illustrations ; $c 24 cm + $e 1 map.',
      ['Which subfield commonly records accompanying material?', '300$e', ['300$a only', '245$c', '264$b']],
      ['What separator commonly introduces accompanying material?', 'A plus sign relationship', ['An equals sign', 'A responsibility slash', 'No separator']]],
    ['multipart-and-nonprint', 'Multipart and nonprint carrier descriptions', 'complex physical description',
      'Nonprint and multipart resources make extent wording more varied and less safely inferred.',
      'Transcribe or record carrier evidence using the applicable standard; automate only known boundaries.',
      'A sound disc, map, or multipart kit may require dimensions and accompanying material unlike a monograph.',
      ['What should automation avoid inferring from a title alone?', 'The resource extent and carrier details', ['The presence of a 300 tag', 'The subfield codes already entered', 'A duplicated generated point']],
      ['What is the safest response to ambiguous carrier evidence?', 'Request cataloguer review and preserve the supplied evidence', ['Guess the most common extent', 'Delete 300', 'Copy the previous record']]]
  ],
  series: [
    ['series-numbering-issn', 'Series numbering and ISSN relationships', 'series elements',
      'Series title, numbering, and ISSN are distinct elements with ordered relationships.',
      'Keep transcribed series elements in sequence and avoid manufacturing unsupported punctuation.',
      '490 1# $a African studies, $x 1234-5678 ; $v volume 12',
      ['Which subfield commonly contains series numbering?', '490$v', ['490$a', '245$c', '300$b']],
      ['Which subfield can contain a series ISSN?', '490$x', ['490$v', '250$b', '020$c']]],
    ['series-authority-workflow', '490/830 authority workflow', 'series authority control',
      'A transcribed series statement and an authorized access point must be reviewed together but not conflated.',
      'Transcribe in 490, verify the controlled form, and record an appropriate 8XX access point.',
      '490 1# preserves the source form while 830 supplies the controlled series access form.',
      ['What does first indicator 1 in 490 signal?', 'A series tracing is made in an 8XX field', ['No series exists', 'The title is nonfiling', 'The field is a note']],
      ['What must be verified before changing 830?', 'The relevant authority evidence', ['The 490 punctuation alone', 'The panel badge', 'The record creation date only']]]
  ],
  'notes-identifiers': [
    ['note-types-and-scope', 'Note types, scope, and punctuation', 'note semantics',
      'Notes serve different purposes, and their internal punctuation may be prose rather than prescribed boundaries.',
      'Choose the appropriate note field, retain meaningful prose punctuation, and normalize only safe terminal duplication.',
      'A 500 general note and a 504 bibliography note should not be selected merely because their text looks similar.',
      ['What determines the MARC note field?', 'The semantic purpose of the note', ['The note length', 'Its last punctuation mark', 'The current lesson number']],
      ['What is a safe automated note change?', 'Removing an exact duplicate generated terminal point', ['Rewriting the note for style', 'Changing its meaning', 'Choosing a specialized note type from wording alone']]],
    ['identifier-qualifiers', 'Identifier qualifiers and canceled numbers', 'identifier structure',
      'Identifiers can carry qualifiers, prices, and status information that punctuation cleanup must preserve.',
      'Distinguish the identifier from qualifiers and canceled or invalid forms before normalizing.',
      '020 ## $a 9781234567890 $q paperback distinguishes the number from its binding qualifier.',
      ['Which subfield commonly carries an ISBN qualifier?', '020$q', ['020$a', '020$z', '245$q']],
      ['Where is a canceled or invalid ISBN commonly recorded?', '020$z', ['020$q', '264$c', '300$e']]]
  ],
  'automation-ai': [
    ['deterministic-versus-inferred', 'Deterministic fixes versus inferred changes', 'automation risk',
      'Reliable automation has bounded inputs, explicit rules, and reversible outputs.',
      'Classify each proposed change as deterministic, evidence-dependent, or professional judgment.',
      'Removing a duplicated generated point is deterministic; selecting an authorized subject from context is inferred.',
      ['Which change is most suitable for deterministic automation?', 'Removing a known duplicated generated delimiter', ['Inventing a missing subtitle', 'Choosing among ambiguous subjects', 'Inferring the chief source']],
      ['What should accompany every automated mutation?', 'A preview, provenance, and an undo path', ['A hidden confidence score only', 'Permanent application', 'Unbounded record rewriting']]],
    ['ai-verification-audit', 'AI verification, confidence, and audit trails', 'AI-assisted review',
      'AI output is a proposal, not authority evidence or a cataloguing rule.',
      'Verify suggestions against supplied evidence and authoritative sources; retain what was requested, returned, and applied.',
      'A suggested LCSH string remains unverified until authority data supports its status.',
      ['What does an AI confidence label prove?', 'Only the model’s reported confidence, not bibliographic correctness', ['That the heading is authorized', 'That the record is complete', 'That no review is needed']],
      ['What should an AI audit trail retain?', 'The request, response, verification state, and applied action', ['Only the final badge color', 'Only accepted suggestions', 'The user password']]]
  ],
  'practical-assessment': [
    ['field-audit-workflow', 'Staged field audit', 'independent field review',
      'A disciplined review separates structure, semantics, punctuation, and authority checks.',
      'Inspect tags and indicators, then subfield roles, then boundaries, then controlled values.',
      'A 245 review starts with indicators and title roles before duplicate punctuation is normalized.',
      ['What is the first stage of a defensible field audit?', 'Confirm field structure and indicator meaning', ['Apply all suggestions', 'Rewrite the title', 'Ignore the source']],
      ['When should a punctuation fix be applied?', 'After the element relationship and provenance are known', ['Whenever a mark looks unusual', 'Before reading the field', 'Only after AI approval']]],
    ['whole-record-risk-triage', 'Whole-record risk triage', 'record-level review',
      'Record-level review prioritizes changes by impact, reversibility, and evidence quality.',
      'Resolve structural errors, review descriptive relationships, verify access points, and document unresolved judgments.',
      'A destructive authority change deserves more scrutiny than a reversible duplicate-point removal.',
      ['Which proposed change deserves the highest review priority?', 'An unverified change to a controlled access point', ['A reversible display-only preview', 'Opening the glossary', 'Moving the training panel']],
      ['What completes a whole-record review?', 'Documented resolution or escalation of remaining material risks', ['A 100% cosmetic progress bar', 'Accepting every suggestion', 'Closing the panel']]]
  ]
};

const coreChallengeSpecs = {
  'records-evidence-judgment': [
    'A vendor record conflicts with the preferred source. What is the defensible action?',
    'Retain the source evidence, resolve what the rules determine, and escalate unresolved judgment',
    ['Accept the vendor record because it already exists', 'Let punctuation software choose the facts', 'Remove every conflicting element']
  ],
  'marc-anatomy': [
    'Two 245 fields appear in a draft record. What should be checked before editing?',
    'Field repeatability, occurrence identity, indicators, and ordered subfield roles',
    ['Only the first visible value', 'Only whether both fields end in a point', 'The alphabetical order of their text']
  ],
  'areas-and-relationships': [
    'A colon appears in a title statement. What proves that it is prescribed?',
    'It expresses a verified relationship between title proper and other title information',
    ['Every title contains a colon', 'The interface colored it green', 'The colon is the final character']
  ],
  'title-relationship-lab': [
    'A 245 contains $a, two $b occurrences, and $c. What is the safe review method?',
    'Evaluate the ordered title elements and each boundary once before changing punctuation',
    ['Apply the same suffix to every subfield', 'Delete repeated $b automatically', 'Move $c before $b']
  ],
  'edition-abbreviations': [
    'An edition abbreviation ends at a generated boundary. What must normalization preserve?',
    'The intrinsic abbreviation point and the separately justified prescribed separator',
    ['Only the last punctuation character', 'A universal single-point rule', 'The shortest possible value']
  ],
  'publication-functions': [
    'A record has 264 #1 and 264 #4 fields. How should they be reviewed?',
    'As separate publication and copyright functions determined by indicator 2',
    ['Merge them into one publication statement', 'Apply publication punctuation to both', 'Ignore both indicators']
  ],
  'physical-relationships': [
    'Why can “ill. ; 24 cm” be correct rather than duplicate punctuation?',
    'The point is intrinsic to the abbreviation and the semicolon introduces dimensions',
    ['All adjacent punctuation is acceptable', 'The semicolon is part of “ill.”', 'Dimensions require two terminators']
  ],
  'series-transcription-access': [
    'A transcribed 490 differs from an authorized 830. What should happen?',
    'Preserve the transcription and verify the controlled access form with authority evidence',
    ['Force both fields to identical wording', 'Delete the 490', 'Treat punctuation as authority evidence']
  ],
  'notes-and-standard-numbers': [
    'A note ends in an abbreviation point and an ISBN has a qualifier. What is safe?',
    'Preserve semantic note punctuation and keep identifier qualifiers in their proper subfields',
    ['Strip all points and qualifiers', 'Move the qualifier into the note', 'Normalize both as plain numbers']
  ],
  'safe-automation-boundaries': [
    'An AI suggestion changes a subject and fixes a duplicate point. How should it be handled?',
    'Separate the deterministic punctuation fix from the authority-sensitive subject proposal',
    ['Apply both because they arrived together', 'Reject both without review', 'Treat model confidence as authority verification']
  ],
  'final-competency-assessment': [
    'A whole-record review contains safe fixes and unresolved descriptive judgments. What demonstrates competency?',
    'Apply only evidenced reversible fixes and document or escalate unresolved judgments',
    ['Apply every available suggestion', 'Complete the progress bar without review', 'Remove uncertain data to finish quickly']
  ]
};

function makeExercise(lessonId, index, spec, skill, difficulty) {
  const [prompt, answer, wrong] = spec;
  const suffixes = ['check', 'apply', 'challenge'];
  const types = ['recognition', 'reasoning', 'application'];
  return {
    id: `${lessonId}-${suffixes[index] || `practice-${index + 1}`}`,
    generated_v4: true,
    type: types[index] || 'application',
    prompt,
    options: [answer].concat(wrong),
    expected_answer: answer,
    hints: [
      `Focus on the bibliographic role, not the visual appearance.`,
      `Compare the supplied evidence with the ${skill.replace(/-/g, ' ')} principle.`
    ],
    explanation: `${answer}. This follows from the lesson's evidence-first treatment of ${skill.replace(/-/g, ' ')}.`,
    referenced_concept: skill.replace(/-/g, ' '),
    skill,
    difficulty
  };
}

function makeLesson(module, spec, position, baseDifficulty) {
  const [id, title, concept, why, learn, see, firstCheck, secondCheck] = spec;
  const skill = module.skills[0];
  return {
    id,
    title,
    generated_v4: true,
    why,
    how: `Work from source evidence, identify the ${concept} relationship, then make only the supported change.`,
    common_mistake: `Treating ${concept} as a visual formatting pattern instead of a bibliographic decision.`,
    do_not_automate: `Do not infer ambiguous ${concept} when the record or source evidence is incomplete.`,
    sections: {
      introduction: `${title} extends the earlier module concepts with a practical review workflow.`,
      why_it_matters: why,
      learn,
      see_it: see,
      reflection: `What evidence would make a ${concept} decision safe, explainable, and reversible?`
    },
    exercises: [
      makeExercise(id, 0, firstCheck, skill, baseDifficulty + position),
      makeExercise(id, 1, secondCheck, skill, baseDifficulty + position + 1),
      makeExercise(id, 2, [
        `A proposed change involves ${concept}, but the record evidence is incomplete. What should the cataloguer do?`,
        `Pause the change, verify the ${concept} evidence, and record or escalate the unresolved judgment`,
        ['Apply the change because the interface suggested it', 'Delete the uncertain element', 'Copy the decision from an unrelated record']
      ], skill, baseDifficulty + position + 2)
    ]
  };
}

function addCoreChallenge(module, lesson) {
  lesson.exercises = (lesson.exercises || []).filter(exercise =>
    !exercise.generated_v4 && !exercise.generated_v41 && !exercise.generated_v42);
  if (lesson.id === 'title-relationship-lab') {
    lesson.exercises.sort((left, right) => Number(left.difficulty || 0) - Number(right.difficulty || 0));
  }
  const spec = coreChallengeSpecs[lesson.id];
  if (!spec) throw new Error(`Missing advanced challenge specification for core lesson ${lesson.id}`);
  const maxDifficulty = Math.max(...lesson.exercises.map(exercise => Number(exercise.difficulty) || 1));
  const skill = (lesson.exercises[lesson.exercises.length - 1] || {}).skill || module.skills[0];
  const challenge = makeExercise(lesson.id, 2, spec, skill, maxDifficulty + 1);
  challenge.id = `${lesson.id}-advanced-challenge`;
  delete challenge.generated_v4;
  challenge.generated_v41 = true;
  lesson.exercises.push(challenge);
  return lesson;
}

function makeModuleCapstone(module, lesson, difficulty) {
  const objectives = (module.objectives || []).slice(0, 3).join(', ');
  const skill = module.skills[module.skills.length - 1] || module.skills[0];
  const exercise = makeExercise(lesson.id, 3, [
    `Capstone case: a proposed ${module.title} change is partly supported, partly ambiguous, and not yet applied. Which workflow demonstrates independent competency?`,
    `Verify the evidence for ${objectives}, apply only supported reversible changes, and document or escalate the ambiguity`,
    [
      'Apply every proposed change to maximize completion',
      'Reject the whole record without examining the supported changes',
      'Use interface confidence and formatting as substitutes for bibliographic evidence'
    ]
  ], skill, difficulty);
  exercise.id = `${module.id}-module-capstone`;
  delete exercise.generated_v4;
  exercise.generated_v42 = true;
  exercise.type = 'cataloguer_judgment';
  exercise.referenced_concept = `${module.title} integrated review`;
  exercise.explanation = `Independent competency in ${module.title} requires evidence-based decisions, reversible application, and explicit escalation of unresolved professional judgment.`;
  return exercise;
}

curriculum.schema_version = '4.2.0';
curriculum.guide_version = '4.2.0';
curriculum.course_version = '4.2.0';
curriculum.course.version = '4.2.0';
curriculum.course.description = 'An 11-lesson path with 112 scored exercises in MARC21, ISBD reasoning, safe automation, and professional cataloguer judgment, sequenced from foundation to independent assessment.';

curriculum.modules.forEach((module, moduleIndex) => {
  const coreLessons = (module.lessons || []).filter(lesson => !lesson.generated_v4)
    .map(lesson => addCoreChallenge(module, lesson));
  const specs = lessonSpecs[module.id] || [];
  const baseDifficulty = module.id === 'practical-assessment'
    ? 3
    : Math.max(...coreLessons.flatMap(lesson => (lesson.exercises || []).map(exercise => Number(exercise.difficulty) || 1)), 1);
  const generated = specs.map((spec, position) => makeLesson(module, spec, position, baseDifficulty));
  const lesson = coreLessons[0];
  if (!lesson) throw new Error(`Missing core lesson for ${module.id}`);
  const supportingExercises = generated.flatMap(item => item.exercises || []);
  const combined = lesson.exercises.concat(supportingExercises)
    .sort((left, right) => Number(left.difficulty || 0) - Number(right.difficulty || 0));
  const capstoneDifficulty = Math.max(...combined.map(exercise => Number(exercise.difficulty) || 1)) + 1;
  lesson.exercises = combined.concat(makeModuleCapstone(module, lesson, capstoneDifficulty));
  module.lessons = [lesson];
  module.assessment.exercise_ids = lesson.exercises.map(exercise => exercise.id);
  module.objectives = Array.from(new Set((module.objectives || []).concat(['Apply concepts in staged interactive practice', 'Explain decisions from evidence'])));
  module.order = moduleIndex + 1;
});

const output = `${JSON.stringify(curriculum, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (fs.readFileSync(curriculumPath, 'utf8') !== output) {
    console.error('intern_guide_v2.json is not regenerated; run node scripts/expand_training_curriculum.js');
    process.exit(1);
  }
} else {
  fs.writeFileSync(curriculumPath, output);
  console.log('Expanded training curriculum written.');
}
