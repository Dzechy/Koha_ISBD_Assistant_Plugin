# Training System Design

The ISBD training system is a professional cataloguing competency course embedded in the Koha cataloguing page. It uses curriculum schema `3.0.0` in `Koha/Plugin/Cataloging/AutoPunctuation/rules/intern_guide_v2.json` and the pure browser/Node model in `js/training_engine.js`.

## Learning model

The course follows **Learn → See → Try → Check → Understand → Practice → Master**. It teaches bibliographic concepts and relationships rather than plugin controls or isolated punctuation marks. Lessons support introduction, why it matters, learning content, annotated examples, interactive practice, feedback, explanation, reflection, and mastery evidence.

The learning path contains eleven ordered modules:

1. Foundations
2. MARC Structure
3. ISBD Areas
4. Title & Responsibility
5. Edition Statements
6. Publication
7. Physical Description
8. Series
9. Notes & Identifiers
10. Automation & AI
11. Practical Assessment

Modules are prerequisite-locked. Completed modules can be revisited. Advanced review mode unlocks navigation explicitly but never changes scores, completion, mastery, or certification.

## Curriculum schema

The JSON model declares course and guide versions, learning model, onboarding screens, glossary, skills, modules, lessons, sections, exercises, hints, expected answers, acceptable alternatives, explanations, rule/concept references, difficulty, prerequisites, assessments, mastery thresholds, and review triggers.

Educational content belongs in JSON whenever it can be safely represented there. Browser code renders only the active lesson and exercise rather than inserting the entire curriculum into the DOM.

## Exercise and feedback model

Supported exercise types include knowledge, recognition, application, field construction, record construction, error detection, reasoning, automation judgment, and cataloguer judgment. The MARC lab edits tags, indicators, ordered subfields, and repeated subfields.

Hints are progressive. A failed attempt records the assessed skill and contributes to weak-skill detection. The model answer is available only through an explicit action; a revealed attempt cannot count toward mastery. Final-assessment policy also excludes hinted attempts where configured.

## Progress and mastery

Progress stores course, guide, and rules versions; onboarding; module and lesson progress; exercise attempts; quiz results; hint use; revealed answers; skill mastery; mistakes; review recommendations; assessment results; recent activity; and last activity.

Completion and mastery are separate:

- A lesson completes only after every required exercise has an independent correct attempt.
- A skill becomes mastered only after enough recent demonstrations meet its threshold and minimum difficulty.
- A module becomes mastered only after lesson completion, assessed-skill mastery, and its assessment threshold.
- Certification requires the final assessment plus mastery of all prerequisite modules.

Recurring mistakes generate targeted remediation. Mastered skills can be selected for spaced review. If course, guide, or rules versions change, completion is preserved while affected modules receive `review_required` state.

## Supervisor reporting

Server progress storage is bounded and normalized. The configuration-page supervisor view reports trainee level, current module, completion, mastery, weak skills, attempts, failed questions, recommendations, assessment status, and last activity. CSV, JSON, and Excel exports use the same visible columns.

## AI tutor boundary

The optional tutor uses the `training_tutor` task. Its request contains a bounded mode, learner question, local curriculum context, and a no-answer flag. Learner text is treated as untrusted. The prompt instructs the model to teach from the supplied curriculum/rule context, respect no-answer hints, avoid MARC mutations, and distinguish deterministic automation from professional judgment.

## Verification

Run:

```bash
node tests/guide_consistency.js
node tests/training_engine_regression.js
perl tests/training_progress_regression.pl
perl tests/ai_subsystem_regression.pl
```

The regression suite covers onboarding, prerequisites, exercise scoring, hints, failure recording, mastery, weak-skill recommendations, persistence, version invalidation, revisiting lessons, supervisor summaries, and final certification.
