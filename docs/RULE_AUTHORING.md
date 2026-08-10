# Rule Authoring

Custom rules should remain punctuation-only unless a local policy explicitly owns the field.

## Safe Pattern

- Scope rules narrowly by `tag`, `subfields`, and indicators.
- For a multi-subfield field, declare each role and `canonical_position` in top-level `field_relationships`. Dependency rules must refer to semantic codes, not array or DOM neighbours.
- Use `prefix`, `suffix`, `prefix_mode`, and `suffix_mode` instead of broad regex rewrites.
- Use `end_not_in` only for exact redundant prescribed punctuation the rule may remove.
- Preserve meaningful periods in data abbreviations such as `p.`, `ill.`, `Co.`, and `ed.`.
- Add shared fixtures when a custom rule changes boundary behavior.
- Add programmatic permutation tests for every set of unlike related codes. Add separate tests showing that repeated occurrences of the same code retain their meaningful order.
- Apply generated punctuation through a finding patch so `punctuation_provenance` can be retained. Never use provenance after its recorded `value` differs from the live value.

## Unsafe Pattern

- Do not write custom rules for authority headings, URLs, control fields, coordinate internals, or local fields by default.
- Do not use broad trailing punctuation stripping to make suffix application easier.
- Do not infer bibliographic relationships from `subfield_index`, previous/next DOM inputs, edit time, or the active field. Indices identify patch targets only.
- Do not claim Area 0 production-process support unless the local mapping and tests exist.

Run:

```sh
node tests/rules_engine_regression.js
perl tests/rules_backend_regression.pl
node tests/semantic_relationship_regression.js
perl tests/semantic_relationship_backend.pl
node tests/guide_consistency.js
```
