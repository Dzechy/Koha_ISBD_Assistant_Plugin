# Rule Authoring

Custom rules should remain punctuation-only unless a local policy explicitly owns the field.

## Safe Pattern

- Scope rules narrowly by `tag`, `subfields`, and indicators.
- Use `prefix`, `suffix`, `prefix_mode`, and `suffix_mode` instead of broad regex rewrites.
- Use `end_not_in` only for exact redundant prescribed punctuation the rule may remove.
- Preserve meaningful periods in data abbreviations such as `p.`, `ill.`, `Co.`, and `ed.`.
- Add shared fixtures when a custom rule changes boundary behavior.

## Unsafe Pattern

- Do not write custom rules for authority headings, URLs, control fields, coordinate internals, or local fields by default.
- Do not use broad trailing punctuation stripping to make suffix application easier.
- Do not claim Area 0 production-process support unless the local mapping and tests exist.

Run:

```sh
node tests/rules_engine_regression.js
perl tests/rules_backend_regression.pl
node tests/guide_consistency.js
```
