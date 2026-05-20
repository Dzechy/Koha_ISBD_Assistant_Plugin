# Intern Guide Design

Guide v2 is data-driven in `Koha/Plugin/Cataloging/AutoPunctuation/rules/intern_guide_v2.json`.

## Model

Each module has `id`, `level`, `title`, `objectives`, `lessons`, `examples`, `quiz`, `scenario_records`, `mastery_threshold`, and `depends_on`. Each lesson includes `why`, `how`, `common_mistake`, and `do_not_automate`.

## Curriculum

- Novice: bibliographic records, MARC tags/indicators/subfields, ISBD areas 0-8, prescribed punctuation, automation boundaries, reading findings, applying/undoing patches.
- Practitioner: Areas 1-8, handoff fields, authority control, AI advisory workflow, and guardrails.
- Reviewer: rationales, false positives, safe custom rules, intern review, regression testing, local policy, and exceptions.

## Progress

Progress records must include guide version and rules version. If either changes, affected modules should be marked for review. Supervisor dashboards should expose not started, in progress, completed, mastered, failed quiz count, last activity, and CSV/JSON export.
