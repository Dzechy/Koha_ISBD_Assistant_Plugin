# Koha ISBD Cataloging Assistant

Koha ISBD Cataloging Assistant is a Koha staff-client plugin that helps catalogers find and fix ISBD punctuation problems in MARC21 bibliographic records. It adds a side panel to Koha's cataloging editor, validates fields with deterministic rules, explains expected punctuation, can block saves when serious findings remain, and can optionally call an AI provider for guided cataloging help.

The rule engine is the source of truth. AI is optional, advisory, and constrained by the deterministic MARC21/ISBD rules. The plugin helps catalogers work faster; it does not replace cataloger judgment, local policy, authority control, or final review.

## Table Of Contents

- [Who This Is For](#who-this-is-for)
- [What The Plugin Does](#what-the-plugin-does)
- [What The Plugin Does Not Do](#what-the-plugin-does-not-do)
- [ISBD And MARC21 Basics](#isbd-and-marc21-basics)
- [ISBD Areas Covered By The Plugin](#isbd-areas-covered-by-the-plugin)
- [Requirements](#requirements)
- [Installation From KPZ](#installation-from-kpz)
- [Koha 26 Compatibility](#koha-26-compatibility)
- [First Run Checklist](#first-run-checklist)
- [Daily Use](#daily-use)
- [Configuration Reference](#configuration-reference)
- [AI Setup](#ai-setup)
- [AI Prompts](#ai-prompts)
- [AI Safety And Context](#ai-safety-and-context)
- [AI Tuning And Limits](#ai-tuning-and-limits)
- [ISBD Guardrails](#isbd-guardrails)
- [Training Workspace And Internship Mode](#training-workspace-and-internship-mode)
- [Custom Rules](#custom-rules)
- [Coverage Report](#coverage-report)
- [Troubleshooting](#troubleshooting)
- [Testing](#testing)
- [Building From Source](#building-from-source)
- [Limitations](#limitations)
- [Donations](#donations)
- [Project Notes](#project-notes)
- [License](#license)

## Who This Is For

This plugin is for Koha libraries that catalog MARC21 bibliographic records and expect ISBD-style punctuation in descriptive fields. It is useful for catalogers, cataloging supervisors, trainers, interns, and Koha administrators who need consistent punctuation checks inside the normal staff-client workflow.

The plugin is ISBD-first, but it can be used in AACR2, RDA, and local MARC21 workflows where the library still records or displays ISBD punctuation.

## What The Plugin Does

- Adds an ISBD assistant panel to `cataloguing/addbiblio.pl`.
- Validates MARC fields and subfields while a record is being edited.
- Shows findings with severity, expected value, and apply/undo controls.
- Applies deterministic punctuation fixes when allowed.
- Supports ghost text and AI Assist for guided suggestions.
- Verifies AI subject candidates against the Library of Congress Linked Data Service and shows authorized labels, variants, evidence, and authority-only retry states.
- Provides an eleven-module cataloguing course with onboarding, practice labs, assessment, remediation, and mastery tracking.
- Lets administrators restrict trainees through internship mode.
- Lets administrators add local JSON rules without editing plugin code.
- Provides a coverage report that shows which active MARC framework fields are covered, excluded, or missing deterministic rules.

## What The Plugin Does Not Do

The plugin does not decide bibliographic description by itself. It does not replace source-of-information review, authority records, subject cataloging policy, classification policy, URL maintenance, local field policy, or a cataloger's final judgment.

It also does not freely rewrite controlled headings, identifiers, URLs, coordinates, structured notes, or local fields. Those areas are guarded because automatic punctuation edits can damage meaning, authority control, access, or local data.

## ISBD And MARC21 Basics

MARC21 records are made of fields. A field has a three-digit tag such as `245`, `260`, `264`, or `300`. Many fields have indicators and subfields. A subfield has a one-character code such as `$a`, `$b`, or `$c`.

Example:

```text
245 10 $a The great Gatsby $b a novel $c F. Scott Fitzgerald
```

In this example:

- `245` is the title statement field.
- The two characters after the tag are indicators.
- `$a` is the title proper.
- `$b` is other title information.
- `$c` is the statement of responsibility.

ISBD uses prescribed punctuation to show the boundaries between areas and elements. That punctuation matters because it tells readers and systems how to interpret the description. A colon, slash, semicolon, comma, equals sign, or period is not just decoration; it often marks a change from one descriptive element to another.

The most important practical rule is that boundary punctuation must live in one place only. Some boundaries are stored as a prefix on the related semantic element. Others are stored as a suffix on the element that bibliographically precedes it. “Precedes” here means the relationship declared in the rule pack, not the order in which Koha happened to create the inputs. The plugin follows `field_relationships` in `Koha/Plugin/Cataloging/AutoPunctuation/rules/isbd_baseline.json`.

Examples:

```text
245$a The great Gatsby
245$b  : a novel
245$c  / F. Scott Fitzgerald.
```

For common title boundaries, the baseline rules use prefix-on-current. The colon belongs at the start of `245$b`, and the responsibility slash belongs at the start of `245$c`.

```text
260$a New York :
260$b Scribner,
260$c 1925.
```

For publication data, some punctuation is suffix-on-previous. The colon after the place can be attached to `260$a`, and the comma before the date can be attached to `260$b`.

```text
300$a xii, 180 pages :
300$b illustrations ;
300$c 23 cm
```

For physical description, the colon and semicolon mark the boundary between extent, other physical details, and dimensions. The plugin avoids adding the same boundary punctuation twice and does not manufacture a general final period for field 300.

Repeated subfields are targeted with `tag`, field occurrence, subfield code, and `subfield_index`. Their meaningful occurrence order is preserved even while unlike subfield codes are resolved in canonical bibliographic order. Plugin-generated punctuation also carries in-memory provenance while its recorded value still matches, allowing a later related subfield to remove generated punctuation without treating every period as disposable data.

See `docs/SEMANTIC_PUNCTUATION_MODEL.md` for the rule architecture and test requirements.

## ISBD Areas Covered By The Plugin

The audit source for this project is the IFLA ISBD 2011 Consolidated Edition 2021 Update PDF included in this repository as `ISBD_Update 2021 to Consolidated ed 2011.pdf`. The detailed coverage matrix is in `docs/ISBD_COVERAGE.md`.

Area 0, content form and media type, is partial/handoff. MARC `336`, `337`, and `338` can provide useful context, but production process is not fully represented by standard MARC fields. The plugin does not generate a complete Area 0 display unless a library adds local mapping rules.

Area 1, title and statement of responsibility, is automated for common `245` and selected `246` patterns. This includes title proper, other title information, responsibility statements, and dependent title punctuation where deterministic.

Area 2, edition area, is automated for `250$a` and `250$b` where terminal punctuation and edition-statement boundaries are deterministic.

Area 3, material- or type-specific area, is mixed. `254$a`, `255$a`, and `362$a` have deterministic checks. Coordinates, projection, equinox, magnitude, and some material-specific details are guarded because internal punctuation depends on the data structure.

Area 4, publication, production, distribution, manufacture, and copyright, is automated for common `260` and `264` `$a`, `$b`, and `$c` patterns. For `264`, the second indicator is used to distinguish production, publication, distribution, manufacture, and copyright. Manufacture details in `$e`, `$f`, and `$g` are guarded where parenthetical grouping cannot be inferred safely.

Area 5, physical description, is automated for common `300$a`, `$b`, `$c`, `$e`, `$f`, and `$g` boundaries.

Area 6, series, is automated for transcribed series fields such as `440` and `490` where deterministic. Controlled series access points in `8XX` are treated conservatively because authority control governs them.

Area 7, notes, is automated for simple note punctuation in selected `5XX` fields. Structured notes are guarded when punctuation is part of an internal syntax.

Area 8, resource identifier and terms of availability, is automated for fields such as `020`, `022`, `024`, and `028` where punctuation can be safely removed or normalized. Identifiers are not treated like free prose.

## Requirements

- Koha `25.11` or `26.05` (including the current `26.05.x` maintenance line).
- Koha plugins enabled.
- Staff permissions to upload, configure, and run plugins.
- A MARC21 bibliographic framework.
- Optional AI features require an OpenAI or OpenRouter API key.
- API key storage requires Koha `encryption_key` configured in `koha-conf.xml`.

Recommended before installation:

- Test first on a staging Koha instance.
- Back up Koha configuration and database data.
- Confirm who is allowed to configure plugins.
- Decide whether save blocking should be enabled immediately or only after staff training.

## Installation From KPZ

Build the KPZ package from the repository root:

```bash
bash scripts/build_kpz.sh
```

The expected package path is:

```text
dist/Koha_ISBD_Assistant-1.4.0.kpz
```

Install it in Koha:

1. Open the Koha staff client.
2. Go to Administration.
3. Open Plugins.
4. Open Manage plugins.
5. Upload the generated KPZ file.
6. Enable the plugin if Koha does not enable it automatically.
7. Open the plugin configure page.
8. Save the initial configuration.
9. Open the plugin tool page if you want the standalone tool view.

The normal cataloging interface is `cataloguing/addbiblio.pl`. That is where the side panel appears.

## Koha 26 Compatibility

Plugin version `1.0.2` and later, including the current `1.4.0`, supports the stock Koha `25.11` and `26.05` plugin controller. Its API methods emit their own CGI status, JSON content type, and JSON body, as required by Koha's `plugins/run.pl`. Plugin POST requests use a form-encoded `payload` and copy `class`, `method`, and `op` into the POST body because Koha `26.05` may not expose URL query parameters through `CGI->param` on POST requests. No Koha core-file override is required.

Koha core-file copies are deliberately excluded from this repository and from the KPZ. Do not copy old `Auth.pm`, `Handler.pm`, or `plugins/run.pl` files over Koha `26.05` files. Koha upgrades replace core files, and an override from another release can break authentication or plugin dispatch.

If an earlier installation applied those overrides, restore the package-owned Koha files before testing `1.4.0`. The recovery helper intentionally supports backup and restore only:

```bash
bash scripts/kohafilesbackup.sh backup
bash scripts/kohafilesbackup.sh restore
```

Only restore a `.bak` file when you know it came from the same installed Koha release. Otherwise reinstall the matching Koha package or recover the files through your normal package-management process.

## First Run Checklist

1. Open the plugin configure page.
2. Confirm `Enable ISBD Intellisense` is on.
3. Confirm `Enable live validation` is on.
4. Leave `Auto-Apply Fixes` off for the first test.
5. Leave `Block Save on Errors` off until staff understand the findings.
6. Review required fields for your local MARC framework.
7. Review excluded tags and local-field settings.
8. Save configuration.
9. Open `cataloguing/addbiblio.pl`.
10. Confirm the ISBD assistant panel appears.
11. Open or create a test bibliographic record.
12. Enter a simple `245`, `260` or `264`, and `300`.
13. Confirm findings appear in the side panel.
14. Apply one suggestion.
15. Undo the suggestion.
16. Save only after confirming the record still matches local cataloging policy.

## Daily Use

The side panel watches the cataloging form. When live validation is enabled, the panel shows findings as fields change. A finding normally includes the affected tag, subfield, severity, message, current value, and expected value.

Use `Apply` when the suggestion is correct. Use `Undo` if the edit is not wanted. When auto-apply is enabled, deterministic punctuation fixes may be applied without pressing each individual button, so use that setting only after staff are comfortable with the rule behavior.

Ghost text and AI Assist are guidance tools. They can help explain a punctuation issue or suggest cataloging values, but deterministic rules and cataloger review still control what is applied.

If save blocking is enabled, unresolved `ERROR` findings or required-field guardrails can stop the record from being saved. Resolve the findings or change configuration if the rule does not match local policy.

## Configuration Reference

### General

`enabled`, shown as `Enable ISBD Intellisense`, defaults to on. It controls whether the cataloging-page assistant runs. Beginners should leave it on. Turn it off only to disable the plugin without uninstalling it.

`auto_apply_punctuation`, shown as `Auto-Apply Fixes`, defaults to off. It allows deterministic fixes to be applied automatically. Beginners should leave it off. Turn it on only after testing the rules against local records.

`default_standard` defaults to `ISBD`. It records the active cataloging standard label. Keep `ISBD` unless future versions add supported alternatives.

### Rules And Guardrails

`enforce_isbd_guardrails` defaults to on. It keeps protected fields from being freely rewritten and ensures AI punctuation suggestions cannot override deterministic checks. Leave it on.

`enable_live_validation` defaults to on. It validates as staff edit. Turn it off only if the cataloging page becomes too slow in a local environment.

`block_save_on_error` defaults to off. It blocks saving when serious findings remain. Use it after staff training and local rule review. Turning it on too early can interrupt cataloging.

`required_fields` defaults to:

```text
0030,0080,040*,040c,942c,100a,245a,260c,300a,050a
```

Tokens are comma-separated. A token such as `245a` means field `245` subfield `$a`. `040*` means a `040` field with any subfield. Control-field positions are represented by normalized tokens such as `0030` and `0080`. Review this list for your framework because not every library requires the same access points or classification fields.

`excluded_tags` defaults to empty. Add tags here when local policy says the plugin should ignore them. This is useful for fields that are managed by another workflow.

`strict_coverage_mode` defaults to off. It makes missing rule coverage more visible. Use it for audits and release testing, not for a first production rollout.

`enable_local_fields` defaults to off. It prevents local `9XX` fields from being checked unless explicitly allowed. Keep it off unless your library has documented local punctuation rules.

`local_fields_allowlist` defaults to empty. Use it with local fields, for example `9XX,952a`, when you want only specific local tags or subfields included.

### Training

`enable_guide` defaults to on. It enables the full ISBD cataloguing training workspace. The workspace includes first-launch onboarding, a prerequisite-based learning path, lesson content, interactive MARC exercises, progressive hints, quizzes, realistic scenarios, spaced review, and a final competency assessment.

`guide_users` defaults to empty. Selected users are excluded from the guide. Use this for experienced staff who do not need training prompts.

`guide_exclusion_list` defaults to empty. It is a manual exclusion list for guide behavior when user selection is not enough.

Progress distinguishes course completion from demonstrated mastery. The configure-page supervisor table reports current module and lesson, completion, mastery, weak skills, attempts, failed questions, review recommendations, assessment status, and last activity. Visible rows can be exported as CSV, JSON, or Excel.

### Internship Mode

`internship_mode` defaults to off. It applies trainee restrictions to selected users.

`internship_users` defaults to empty. Select the staff accounts that should be treated as trainees.

`internship_exclusion_list` defaults to empty. Use this field as an additional comma-separated trainee user list when the selector is not enough. Users listed here receive the same internship restrictions as users selected in `internship_users`.

`intern_allow_assistant_toggle` defaults to off. Trainees cannot toggle the assistant unless this is enabled.

`intern_allow_autoapply_toggle` defaults to off. Trainees cannot toggle auto-apply unless this is enabled.

`intern_allow_cataloging_panel` defaults to on. Trainees can show the cataloging assistant panel by default.

`intern_allow_ai_assist_toggle` defaults to off. Trainees cannot toggle AI Assist unless this is enabled.

`intern_allow_panel_apply_actions` defaults to off. Trainees cannot apply or undo panel suggestions unless this is enabled.

`intern_allow_ai_cataloging` defaults to off. Trainees cannot make AI cataloging requests unless this is enabled.

`intern_allow_ai_punctuation` defaults to off. Trainees cannot make AI punctuation requests unless this is enabled.

`intern_allow_ai_apply_actions` defaults to off. Trainees cannot apply AI panel actions, including subjects, classification, call numbers, or AI punctuation patches, unless this is enabled.

### Debug

`debug_mode` defaults to off. It writes plugin debug messages to Koha server logs with the prefix `AutoPunctuation debug:`. Turn it on only while diagnosing a problem.

`ai_debug_include_raw_response` defaults to off. It can include sanitized raw provider text for debugging. Use it carefully because AI output can contain record text.

## AI Setup

AI is optional. The plugin works without an AI provider.

Supported providers:

- OpenRouter, the default and recommended provider in the configure page.
- OpenAI.

Basic setup:

1. Configure Koha `encryption_key` in `koha-conf.xml`.
2. Open the plugin configure page.
3. Enable `AI Assist`.
4. Choose OpenRouter or OpenAI.
5. Enter the API key.
6. Select or refresh the model list.
7. Save configuration.
8. Use `Test connection`.

The configure page stores API keys server-side. A stored key is not printed back into the password field. Use `Clear key` when you need to remove it.

AI feature toggles:

- `ai_enable` defaults to on. It enables the AI panel features when provider setup is complete.
- `ai_punctuation_explain` defaults to on. It allows field-level punctuation guidance.
- `ai_subject_guidance` defaults to on. It allows subject-heading guidance.
- `ai_callnumber_guidance` defaults to on. It allows call-number guidance.
- `lc_class_target` defaults to `050$a`. Change it if your library records LC classification in another target.

Model selection is provider-specific. The configure page remembers OpenRouter and OpenAI model choices separately where possible.

## AI Prompts

`ai_prompt_default` is the punctuation guidance prompt. It should keep the model focused on explaining and suggesting punctuation-compatible changes.

`ai_prompt_cataloging` is the cataloging prompt for classification and subject suggestions. It supports `{{source_text}}`, which is populated from the highest-priority meaningful bibliographic context available rather than requiring `245$a`.

Customize prompts only when you have a clear local policy need. Do not remove instructions that require JSON shape, punctuation-only behavior for punctuation patches, deterministic-rule compliance, or safe handling of record content. A weaker prompt can increase rejected patches or unsafe advice, but it cannot bypass server-side guardrails.

Prompt length is limited by `ai_prompt_max_length`, which defaults to `16384` characters.

## AI Safety And Context

`ai_redaction_rules` defaults to:

```text
9XX,952,5XX
```

These rules reduce what record data is sent to the provider. Keep local fields redacted unless your library has approved sending them.

`ai_redact_856_querystrings` defaults to on. It removes query strings from `856$u` URLs before AI requests. Keep it on because query strings can contain tokens, session data, or patron-related parameters.

`ai_context_mode` defaults to `tag_only`. Available modes are:

- `tag_only`: send only the active tag context.
- `tag_plus_related_fields`: include bibliographically relevant fields rather than adjacent DOM fields.
- `full_record`: include the redacted full record.

Start with `tag_only` for field-level punctuation explanations. Classification, subject, and cataloguing-review tasks automatically receive a bounded, redacted set of bibliographically relevant fields because they require record-level evidence; this task-specific override does not enable blind full-record submission. Missing fields reduce confidence or specificity instead of blocking a request, and only a record with no meaningful evidence returns `insufficient_evidence`.

`ai_payload_preview` defaults to off. It lets administrators inspect the AI payload before sending. Turn it on when validating redaction behavior or debugging provider requests.

AI never supplies an applicable punctuation patch. The deterministic rules engine generates punctuation fixes; AI may only explain those verified findings.

Classification candidates are checked server-side against the exact `lccs-2024@1.1.0` dataset published on npm. Full call numbers are retained, while verification checks the longest exact schedule prefix represented in the package. An exact schedule/page match is returned as structured `evidence_verification` and labelled `verified`; this verifies that the schedule number exists, not that the complete shelf number is correct or best for the work. `invalid_candidate`, `not_checked`, `no_match`, and `unavailable` remain explicit non-verified states and preserve valid advisory candidates for cataloguer review.

For source builds, run `npm ci` before tests or KPZ packaging. The build bundles the pinned LCCS runtime data into the KPZ, so the Koha host does not need to run npm after plugin installation. The machine-readable dataset complements but does not replace official LC policy, local classification practice, or professional judgment.

## AI Tuning And Limits

Defaults:

- `ai_reasoning_effort`: `low`.
- `ai_timeout`: `60` seconds.
- `ai_max_output_tokens`: `10000`.
- `ai_temperature`: `0.1`.
- `ai_confidence_threshold`: `0.85`.
- `ai_rate_limit_per_minute`: `30`.
- `ai_cache_ttl_seconds`: `300`.
- `ai_cache_max_entries`: `1000`.
- `ai_retry_count`: `1`.
- `ai_circuit_breaker_threshold`: `5`.
- `ai_circuit_breaker_timeout`: `45` seconds.
- `ai_circuit_breaker_window_seconds`: `180`.
- `ai_circuit_breaker_failure_rate`: `0.5`.
- `ai_circuit_breaker_min_samples`: `6`.
- `ai_openrouter_response_format`: off by default.

Recommended beginner/admin choices:

- Keep temperature low for consistent cataloging advice.
- Keep the rate limit conservative until you understand provider costs.
- Keep cache enabled to reduce repeat requests.
- Increase timeout only if the selected model regularly needs more time.
- Change reasoning effort only for models that support it.
- Treat circuit breaker settings as operational safety controls. They stop repeated provider failures from slowing cataloging.

Cache effects can make repeated AI requests return quickly without a fresh provider call until the TTL expires.

## ISBD Guardrails

Deterministic rules are the source of truth. AI cannot override them.

The plugin intentionally guards:

- Controlled headings and authority-controlled access points.
- URLs and electronic access fields such as `856`.
- Coordinates, projections, and other structured cartographic data.
- Local `9XX` fields unless explicitly enabled.
- Structured notes where punctuation has local or field-specific meaning.
- Standard identifiers where punctuation is not prose punctuation.

This is why some fields are shown as partial, handoff, or guarded in the coverage matrix. A safe assistant should avoid damaging data it cannot understand deterministically.

## Training Workspace And Internship Mode

The training workspace is a professional cataloguing course, not a feature tour. It follows **Learn → See → Try → Check → Understand → Practice → Master** across eleven modules: Foundations, MARC Structure, ISBD Areas, Title & Responsibility, Edition Statements, Publication, Physical Description, Series, Notes & Identifiers, Automation & AI, and Practical Assessment.

First launch asks about experience and explains the learning model. Each lesson teaches why a concept matters, shows a MARC example, and provides several exercise types. The MARC lab supports tag, indicator, and subfield editing, adding/removing subfields, and reordering repeated subfields. Incorrect answers are recorded without immediately revealing the answer; hints become progressively more specific. Revealed answers cannot award mastery.

Modules unlock only after prerequisite mastery. Completion means the required lesson work was done; mastery additionally requires sufficient independent performance at the configured threshold. Recurring mistakes create targeted review recommendations, and previously learned skills return as spaced review. Advanced review mode unlocks navigation for explicit review but never grants completion or mastery.

The optional AI tutor can explain a concept, offer a no-answer hint, or point to the supplied rule context. It is constrained by the curriculum and remains advisory. Deterministic rules and authoritative cataloguing sources remain primary.

The workspace can remain enabled for new cataloguers while experienced staff are excluded through `guide_users`. Curriculum data lives in `Koha/Plugin/Cataloging/AutoPunctuation/rules/intern_guide_v2.json` using schema and guide version `3.0.0`. When course, guide, or rules versions change, completed work is preserved but marked as requiring review.

Internship mode is stricter. It lets supervisors choose trainee accounts and decide whether those users can toggle the assistant, toggle auto-apply, show the panel, use AI, apply panel actions, or apply AI-generated actions.

Suggested rollout:

1. Enable the training workspace.
2. Keep auto-apply off.
3. Keep save blocking off.
4. Put trainees in internship mode.
5. Allow panel visibility but restrict apply actions at first.
6. Review completion, mastery, weak skills, and assessment status during training.
7. Use progress exports for supervision and local records.
8. Gradually allow apply/undo after staff demonstrate consistency.

## Custom Rules

Custom rules are JSON stored in the configure page. The value may be `{}` or an object with a `rules` array.

Custom rules are appended to the baseline rule pack; they do not replace baseline rules. Avoid duplicating a built-in rule unless the duplication is intentional and has been tested.

Example local rule:

```json
{
  "rules": [
    {
      "id": "CUSTOM_949A_LOCAL_NOTE_PERIOD",
      "tag": "949",
      "subfields": ["a"],
      "severity": "INFO",
      "rationale": "Local policy: locally owned 949$a processing notes should end with terminal punctuation.",
      "checks": [
        {
          "type": "punctuation",
          "suffix": ".",
          "end_in": [".", "?", "!"],
          "severity": "INFO",
          "message": "Add terminal punctuation to local processing note."
        }
      ],
      "fixes": [
        {
          "label": "Apply local note punctuation",
          "patch": [
            {
              "op": "replace_subfield",
              "value_template": "{{expected}}"
            }
          ]
        }
      ],
      "examples": [
        {
          "before": "Local processing note",
          "after": "Local processing note."
        }
      ]
    }
  ]
}
```

This example assumes local fields are enabled and `local_fields_allowlist` includes `949` or `949a`.

Supported check types include `punctuation`, `separator`, `no_terminal_punctuation`, `spacing`, `normalize_punctuation`, and `fixed_field`. Severities are `ERROR`, `WARNING`, and `INFO`.

Safe rule-writing guidance:

- Use a unique `id`.
- Target the narrowest tag and subfield that matches local policy.
- Prefer explicit `tag` and `subfields` over broad regexes.
- Avoid duplicating baseline rules unless you intend to change local behavior.
- Test custom rules on sample records before production use.
- Export rules before major edits.

Custom rules are merged after baseline rules. A conflicting custom rule can create confusing or contradictory advice.

The configure page supports importing and exporting JSON rules.

## Coverage Report

The coverage report compares active MARC framework fields with the active rule pack.

Statuses:

- `Covered`: at least one deterministic rule matches the field/subfield.
- `Excluded`: the field is intentionally ignored by settings or guardrails.
- `Not covered`: no active deterministic rule covers it.

Missing coverage does not always mean a bug. It may mean the field requires authority control, source inspection, local policy, or structured syntax that should not be automated.

The report also provides recommended rule stubs. Treat those stubs as starting points, not production-ready policy.

## Troubleshooting

Panel does not appear:

- Confirm the plugin is installed and enabled.
- Confirm `Enable ISBD Intellisense` is on.
- Confirm you are on `cataloguing/addbiblio.pl`.
- Hard-refresh the browser.
- Check browser console errors.
- Check Koha server logs.

Configuration will not save or API calls fail:

- Confirm staff session is valid.
- Log out and back in.
- Check CSRF/session errors in browser and Koha logs.
- Confirm plugin version `1.0.2` or newer is installed after upgrading to Koha `26.05`.
- If the response is an HTML Koha 500 page instead of JSON, reinstall the matching Koha core package files and then reinstall the current KPZ.
- Remove legacy local overrides; do not copy the repository reference files over Koha `26.05`.

AI is disabled or unavailable:

- Confirm `AI Assist` is enabled.
- Confirm Koha `encryption_key` exists.
- Confirm an API key is stored.
- Confirm provider is correct.
- Refresh the model list.
- Use `Test connection`.
- Check firewall/proxy access from the Koha server.
- Check provider quota, rate limits, and API status.

AI model list fails:

- Check the key and provider.
- Check Koha logs for `ai_models` errors.
- Confirm the Koha server can reach OpenRouter or OpenAI.

AI request fails repeatedly:

- The circuit breaker may be open after repeated failures.
- Wait for the circuit breaker timeout.
- Lower request rate.
- Try a different model.
- Check provider errors and Koha logs.

Save is blocked:

- Open the assistant panel.
- Resolve `ERROR` findings.
- Check required-field findings.
- Confirm the field is not intentionally absent under local policy.
- Adjust `required_fields` or save-blocking configuration only when the rule does not match local practice.

Suggestion targets the wrong repeated subfield:

- Refresh the record page.
- Run validation again.
- Confirm the finding includes the correct repeated subfield target.
- Report the tag, occurrence, subfield, `subfield_index`, current value, and expected value if it still mis-targets.

Koha upgrade broke the plugin:

- Install plugin version `1.0.2` or newer.
- Remove legacy Koha core overrides if staff login or plugin dispatch fails.
- Restore only backups made from the same Koha release, or reinstall the matching Koha package files.
- Restart the relevant Plack/Koha services, sign in again, and hard-refresh the staff client.

Useful debug evidence:

- Koha version.
- Plugin version.
- Browser console error.
- Koha server log excerpt.
- A redacted MARC field example.
- The setting values for live validation, save blocking, excluded tags, local fields, AI provider, and context mode.
- Sanitized raw AI response only when `ai_debug_include_raw_response` is needed.

## Testing

Run the documentation and rule checks from the repository root:

```bash
node tests/docs_examples.js
node tests/guide_consistency.js
node tests/training_engine_regression.js
node tests/rules_engine_regression.js
node tests/semantic_relationship_regression.js
node tests/koha26_transport.js
perl tests/rules_backend_regression.pl
perl tests/semantic_relationship_backend.pl
perl tests/training_progress_regression.pl
perl tests/ai_subsystem_regression.pl
perl tests/http_response_regression.pl
```

Build the package:

```bash
bash scripts/build_kpz.sh
```

Confirm the artifact exists:

```text
dist/Koha_ISBD_Assistant-1.4.0.kpz
```

Some Perl compile checks require Koha modules in `@INC`; run those inside a Koha environment.

## Building From Source

Build a local KPZ package from a checkout of the project:

```bash
bash scripts/build_kpz.sh
```

The build writes the installable plugin package to:

```text
dist/Koha_ISBD_Assistant-1.4.0.kpz
```

Before sharing a package with another Koha site, run the tests in the previous section and install the KPZ in a staging Koha instance.

## Limitations

- The plugin does not replace cataloger judgment.
- The plugin does not replace authority control.
- ISBD Area 0 production process is only partial/handoff unless local mapping is added.
- Complex structured notes are intentionally conservative.
- Local fields are excluded unless explicitly enabled.
- Custom rules can conflict with baseline rules.
- Browser behavior depends on Koha cataloging form markup exposing stable MARC tag and subfield controls.
- AI results depend on provider availability, model behavior, rate limits, and local privacy policy.

## Donations

If this plugin is useful to your library, donations would help support ongoing maintenance and testing.

- Non-crypto donation: [Here](https://selfany.com/kohaISBDplugindonation)
- BTC: `19JSzRPB5qp3TKZVBeVUR8xmgntxKui5cc`
- ETH (ERC20): `0x5cc9f67d0f8328a46b9f9e12a1cfbf1a379e5947`
- USDT (ERC20): `0x5cc9f67d0f8328a46b9f9e12a1cfbf1a379e5947`
- USDC (ERC20): `0x5cc9f67d0f8328a46b9f9e12a1cfbf1a379e5947`
- LTC: `LesDgPh9BVp8SgbXqk8GbyCzHwnrgn7tDv`

## Project Notes

This plugin is a refactor of `Koha_AACR2_Cataloging_Assistant` onto an ISBD-first foundation. Upstream-friendly Koha plugin hooks for dispatch/auth behavior would make the integration easier to maintain across upgrades.

## License

GPL-3.0. See `LICENSE`.
