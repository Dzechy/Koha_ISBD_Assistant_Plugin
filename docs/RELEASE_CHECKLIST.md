# Release Checklist

Use this checklist before publishing a release-candidate KPZ.

## Local Verification

- Confirm `PluginGithubPAT`, KPZ/ZIP artifacts, temp files, logs, caches, and local Koha/environment files are not staged.
- Validate the rule pack JSON:
  `node -e "JSON.parse(require('fs').readFileSync('Koha/Plugin/Cataloging/AutoPunctuation/rules/isbd_baseline.json','utf8'))"`
- Run JavaScript rule regressions:
  `node tests/rules_engine_regression.js`
- Run Perl rule regressions:
  `perl tests/rules_backend_regression.pl`
- Confirm guide/rule fixture consistency:
  `node tests/guide_consistency.js`
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
- Inspect the package contents and confirm it contains only plugin source plus release docs/license:
  `unzip -l /home/anonymous/Downloads/Koha_ISBD_Cataloging_Assistant-1.0.0.kpz`
- Confirm the KPZ does not contain `PluginGithubPAT`, previous KPZ/ZIP files, `.git`, caches, logs, or local environment files.

## Koha Smoke Test

- Upload the KPZ in a Koha `25.11+` test instance with plugins enabled.
- Open the configure page and save settings with AI disabled.
- Open the tool page and confirm the guide and coverage views render.
- On `cataloguing/addbiblio.pl`, confirm live validation appears for representative `245`, `250`, `260/264`, `300`, `490`, `5XX`, and standard-number fields.
- Confirm save blocking only occurs for configured ERROR guardrails.
- Confirm AI-disabled mode produces no external network request.
- With a test API key, confirm AI suggestions remain advisory and punctuation patches are rejected when they conflict with deterministic rules.
- Confirm dispatch/auth reference files (`Auth.pm`, `Handler.pm`, `run.pl`) are treated as reference deltas only and are not blindly copied over a production Koha install.
