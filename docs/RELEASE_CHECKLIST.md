# Release Checklist

Use this checklist before publishing a release-candidate KPZ.

## Local Verification

- Confirm `PluginGithubPAT`, KPZ/ZIP artifacts, temp files, logs, caches, and local Koha/environment files are not staged.
- Install the exact published build dependency: `npm ci`.
- Run LCCS package and server-adapter regressions:
  `npm run test:lccs`
  `perl tests/lccs_evidence_regression.pl`
- Validate the rule pack JSON:
  `node -e "JSON.parse(require('fs').readFileSync('Koha/Plugin/Cataloging/AutoPunctuation/rules/isbd_baseline.json','utf8'))"`
- Run JavaScript rule regressions:
  `node tests/rules_engine_regression.js`
- Run Perl rule regressions:
  `perl tests/rules_backend_regression.pl`
- Run the stock-Koha CGI response regression:
  `perl tests/http_response_regression.pl`
- Run the Koha 26 POST transport regression:
  `node tests/koha26_transport.js`
- Confirm guide/rule fixture consistency:
  `node tests/guide_consistency.js`
- Run training competency regressions:
  `node tests/training_engine_regression.js`
- Run server progress normalization regressions:
  `perl tests/training_progress_regression.pl`
- Run AI subsystem and tutor-boundary regressions:
  `perl tests/ai_subsystem_regression.pl`
- Run catalogue-context, response-pipeline, LCCS, and LOC authority regressions:
  `node tests/ai_cataloging_context_regression.js`
  `perl tests/ai_cataloging_pipeline_regression.pl`
  `perl tests/lccs_evidence_regression.pl`
  `perl tests/loc_linked_data_regression.pl`
- Optionally verify the live LOC endpoint when external network access is available:
  `LOC_LIVE_TEST=1 perl tests/loc_linked_data_live.pl`
- Confirm documentation examples match engine behavior:
  `node tests/docs_examples.js`
- Confirm Area 0 wording remains partial/handoff and never states that `338` is ISBD production process.
- Confirm README, tool page, guide, and fixtures use the same `245` prefix-on-current boundary convention.
- Confirm full-text search finds no wording that assigns the 264 function to the wrong indicator.
- Compile standalone Perl modules that do not require a Koha runtime:
  `perl -c Koha/Plugin/Cataloging/AutoPunctuation/Rules.pm`
  `perl -c Koha/Plugin/Cataloging/AutoPunctuation/AI/Guard.pm`
  `perl -c Koha/Plugin/Cataloging/AutoPunctuation/Updates.pm`
- Treat `perl -c Koha/Plugin/Cataloging/AutoPunctuation.pm` outside Koha as an expected local limitation when `Koha::Plugins::Base` and other Koha modules are unavailable.

## Package Verification

- Build the KPZ:
  `./scripts/build_kpz.sh`
- Inspect the package contents and confirm it contains plugin source, the pinned LCCS runtime dataset, and release docs/license:
  `unzip -l dist/Koha_ISBD_Assistant-1.4.0.kpz`
- Confirm the KPZ does not contain `PluginGithubPAT`, previous KPZ/ZIP files, `.git`, caches, logs, or local environment files.
- Confirm repository-only classification schedules under `docs/LCCS` are not included in the KPZ.
- Confirm `vendor/node_modules/lccs-2024/package.json` is present and pinned to `1.1.0`.

## Koha Smoke Test

- Upload the KPZ in Koha `25.11` and `26.05` test instances with plugins enabled.
- Open the configure page and save settings with AI disabled.
- Open the tool page and confirm the guide and coverage views render.
- Open training as a first-time user and complete all four onboarding screens.
- Confirm prerequisite modules are locked, advanced review mode unlocks navigation only, and completed modules can be revisited.
- Confirm wrong answers, progressive hints, answer reveal, reset, MARC subfield add/remove/reorder, and lesson completion behave as documented.
- Confirm revealed or skipped practice cannot award mastery or final certification.
- Confirm the supervisor table reports completion and mastery separately, weak skills, attempts, failures, recommendations, assessment, and last activity; export CSV, JSON, and Excel once.
- On `cataloguing/addbiblio.pl`, confirm live validation appears for representative `245`, `250`, `260/264`, `300`, `490`, `5XX`, and standard-number fields.
- Confirm save blocking only occurs for configured ERROR guardrails.
- Confirm AI-disabled mode produces no external network request.
- With a test API key, confirm AI suggestions remain advisory and punctuation patches are rejected when they conflict with deterministic rules.
- Confirm the API responses use stock Koha `plugins/run.pl` and return JSON for both successful and failed requests.
- Confirm POST API calls include `class`, `method`, `op`, and form-encoded JSON `payload` fields in the request body.
- Confirm legacy dispatch/auth reference files (`Auth.pm`, `Handler.pm`, `run.pl`) have not been copied over the Koha `26.05` package files.
