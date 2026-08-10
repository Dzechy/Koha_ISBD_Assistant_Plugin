# Semantic MARC Relationship and Punctuation Audit

Audit date: 2026-08-10  
Rule-pack version: 1.1.0  
Primary standard source: repository copy of *ISBD: International Standard Bibliographic Description, 2011 Consolidated Edition, 2021 Update*  
MARC sources: Library of Congress MARC 21 Bibliographic field documentation for [245](https://www.loc.gov/marc/bibliographic/bd245.html), [246](https://www.loc.gov/marc/bibliographic/bd246.html), [250](https://www.loc.gov/marc/bibliographic/bd250.html), [255](https://www.loc.gov/marc/bibliographic/bd255.html), [260](https://www.loc.gov/marc/bibliographic/bd260.html), [264](https://www.loc.gov/marc/bibliographic/bd264.html), [300](https://www.loc.gov/marc/bibliographic/bd300.html), and [490](https://www.loc.gov/marc/bibliographic/bd490.html).

## A. Bugs discovered

| Field/component | Previous behaviour | Problem |
| --- | --- | --- |
| Shared JavaScript and Perl engines | `following`, `preceding`, `next`, and `previous` conditions scanned array positions. | Equivalent MARC content produced different findings when Koha inputs were created in a different order. |
| UI/AI context | The active subfield was moved to array position zero; server fallbacks and cache text used the first array item. | Physical order was being used as semantic identity, and patch indices could become detached from live structure. |
| Punctuation provenance | Generated punctuation was indistinguishable from catalogued data. | A later relationship change could either leave stale punctuation or remove a legitimate point. |
| `245$b` | A field-final point could survive before related `$c`; broad terminal stripping could also damage intrinsic points. | Output could become `a novel. / Author`, while legitimate abbreviations and ellipses were at risk. |
| `245$b` text | `initial_lower` changed the first letter. | A punctuation engine was rewriting catalogued text. |
| `245$n/$p/$c` | Prefix/suffix checks depended on DOM neighbours. | Part, title, and responsibility punctuation varied by entry order. |
| `246$a` | Indicator 1 value `3` forced a terminal point. | MARC 21 says field 246 has no manufactured final punctuation. |
| `250$a/$b` | The additional-edition delimiter was incompletely coordinated, and adding a comma could remove `ed.`. | `2nd ed.` plus `$b` could render without the prescribed delimiter or lose abbreviation punctuation. |
| `260/264` repeated `$a` | The later place received a semicolon prefix while the earlier place received the wrong boundary. | Combined display became order-dependent and structurally awkward. |
| `264` indicator 2 value `4` | Copyright dates received a terminal point. | MARC examples and input convention use the copyright notice without manufactured ending punctuation. |
| `300` | Most final subfields received an unconditional point. | MARC 21 permits field 300 to end without punctuation; `cm` and `mm` are not abbreviations. |
| `300` repeated `$a` | Every occurrence could receive the next-element boundary. | Multiple extents could be punctuated as though each were the final extent occurrence. |
| `490$a/$v/$x` | Final points were manufactured and a final ISSN point was stripped unconditionally. | MARC 21 says 490 has no manufactured final mark unless the ending punctuation is data-dependent. |
| `255$b-$g` | Internal values were hands-off, but no safe semantic-final rule existed. | The final mathematical element could lack field-ending punctuation while an earlier physical input received it. |
| Ellipses | Repeated terminal stripping could reduce `...` to `.`. | Title data was corrupted by a terminal-point cleanup path. |
| Rendering/API | No public normalization, semantic rendering, or MARC-safe serialization boundary existed. | Tests and callers could conflate internal presentation metadata with stored MARC data. |

## B. Bugs fixed

- Added explicit `field_relationships` with roles and canonical positions. Unlike subfield codes use semantic position; repeated instances of the same code retain physical occurrence order.
- Replaced physical neighbour checks in both engines with the shared semantic relation algorithm. Undeclared custom/legacy fields retain their old behaviour for compatibility.
- Stopped UI context reordering. The active code is carried separately, AI fallback selection is semantic, and AI cache text is canonicalized without changing patch indices.
- Added plugin punctuation provenance to findings, patches, UI state, request schemas, and the Perl AI guardrail. Provenance is used only while its stored value exactly matches the live value.
- Added conservative `245$b` point handling: generated terminal punctuation is removable; explicit intrinsic provenance, ellipses, initials, and known abbreviations are preserved.
- Added public `normalizeField`, `normalizeRecord`, `semanticSubfields`, `renderField`, `serializeField`, and `serializeRecord` functions. Serialization strips internal provenance.
- Preserved field tags, indicators, occurrences, physical subfield arrays, repeated fields, and meaningful same-code ordering.
- Removed the impossible/dead repeated-place rule and obsolete physical-neighbour helper functions.
- Corrected field rules described below and updated UI guide text, prompts, schemas, fixtures, manual, coverage matrix, and rule-authoring guidance.

## C. Fields audited

The complete rule pack was scanned for following/preceding conditions, next/previous assumptions, unconditional terminal punctuation, broad stripping, and duplicate-boundary handling. Detailed field review covered:

- `245$a$b$c$n$p`
- `246$a`, first-indicator values `0`, `1`, `2`, and `3`
- `250$a$b`
- `255$a$b$c$d$e$f$g`
- `260$a$b$c$e$f$g`
- `264$a$b$c`, second-indicator values `0` through `4`, plus guarded manufacture subfields
- `300$a$b$c$e$f$g`
- `440$a$v$x`
- `490$a$v$x`
- controlled `8XX` series handoffs
- global spacing, area-separator, standard-number, heading, note, and fallback rules

No dependency-bearing baseline rule remains outside a declared relationship model.

## D. Fields changed

Behaviour changed for `245`, `246`, `250`, `255`, `260`, `264`, `300`, `440`, and `490`. Shared UI/API context handling and all rules using semantic dependency primitives also changed. Controlled headings, URLs, coded fields, and complex internal cartographic/manufacture data remain guarded.

## E. Rules changed

| Rule scope | New behaviour |
| --- | --- |
| `ISBD_TITLE_245A/B/C/N/P_*` | Resolve title roles semantically; remove a non-intrinsic/generated `$b` terminal point before `$c`; preserve legitimate points and ellipses; do not change capitalization. |
| `ISBD_VARIANT_TITLE_246_*` | Preserve data-dependent punctuation and manufacture no field-ending point. |
| `ISBD_EDITION_250A_HAS_B`, `ISBD_EDITION_250B_001` | `$a` owns comma/equal/slash boundary to semantic `$b`; abbreviation point remains, producing `2nd ed., revised.`. |
| `ISBD_PUBL_260A_NONFINAL` and related publication rules | Earlier repeated places receive semicolon suffixes, the last place receives colon/comma according to `$b/$c`, and all relationships ignore input order. |
| `ISBD_PUBL_264_COPYRIGHT_C` | Remove manufactured terminal punctuation for second indicator `4`. |
| `ISBD_PHYS_300*` | Add only colon/semicolon/plus element boundaries; do not manufacture a general final point; preserve abbreviation and parenthetical data; apply a next-element boundary only to the final repeated occurrence. |
| `ISBD_SERIES_490A/V/X` | Use comma before ISSN and semicolon before numbering; manufacture no final 490 punctuation; preserve data-dependent ending punctuation. |
| `ISBD_CARTO_255A/B/C_G_*` | Preserve ratio colons and complex internal syntax; place a terminal point only on the final semantic mathematical element. |

## F. Tests added

- JavaScript property/permutation tests for every requested `245` combination and all permutations of important `250`, `255`, `260`, `264`, `300`, and `490` structures.
- Perl property/permutation parity tests for the same core fields (211 assertions).
- Finding/guardrail invariance across permutations.
- Exact regression for `245$b` before `$c`, intrinsic and generated provenance, non-duplicated `$c`, `$n/$p`, parallel `250`, repeated publication places, repeated `300$a`, `490`, `246`, `255`, and copyright `264`.
- Edge tests for empty values, whitespace, existing punctuation, abbreviations, initials, multiple responsibility statements, quoted titles, parentheses, and ellipses.
- MARC structure preservation, normalization idempotency, presentation rendering, MARC-safe serialization, and save/reload stability.
- Server AI/cache semantic-order and active-semantic-fallback assertions.
- Existing JavaScript fixtures and 68-test Perl regression suite updated to the corrected MARC conventions.

## G. Tests passed

The following commands were run successfully from the repository root on 2026-08-10:

```text
node tests/rules_engine_regression.js
  rules_engine_regression: ok

perl tests/rules_backend_regression.pl
  1..68 (all passed)

node tests/semantic_relationship_regression.js
  semantic_relationship_regression: ok

perl tests/semantic_relationship_backend.pl
  1..211 (all passed)

node tests/docs_examples.js
  docs_examples: ok

node tests/guide_consistency.js
  guide_consistency: ok

node tests/koha26_transport.js
  koha26_transport: ok

perl tests/http_response_regression.pl
  1..7 (all passed)
```

Static verification also passed for Perl syntax, all JSON files, the combined intranet JavaScript bundle, `git diff --check`, and a scan confirming that every baseline rule with a preceding/following dependency belongs to a declared field relationship model.

## H. Tests that could not run

A real Koha staff-client browser smoke test, database-backed MARC save, and KPZ installation test could not run because this workspace is the plugin source tree, not a running Koha instance. The automated suite compiles the complete intranet JavaScript bundle and simulates normalization, rendering, serialization, reload, and server validation, but release validation should still exercise the UI in supported Koha versions.

## I. Remaining risks

- Some valid `245` records contain alternating `$b/$n/$p` title blocks. Codes alone cannot always identify which other-title information belongs to which part. The baseline chooses a deterministic simple-field canonical model and preserves repeated same-code order; complex alternating blocks require cataloger review.
- MARC 21 allows a final point in `300` when a `490` exists elsewhere in the record. Field-level editing does not always have reliable whole-record context, so the engine conservatively avoids manufacturing it. This record-level exception remains manual.
- Internal `255` coordinate/equinox/G-ring syntax and `260/264$e$f$g` parenthetical manufacture syntax remain hands-off beyond safe outer boundaries.
- Provenance is session-local in the Koha UI and intentionally is not serialized into MARC. After a reload, narrow heuristics protect common abbreviations and ellipses, but genuinely ambiguous terminal punctuation still needs human review.
- Custom multi-subfield rules without a `field_relationships` declaration retain legacy physical-order semantics for backward compatibility. New custom rules must declare their semantic model and add permutation tests.
- Local cataloging policy, nonroman punctuation, source-of-information decisions, and authority-controlled fields remain cataloger responsibilities.
