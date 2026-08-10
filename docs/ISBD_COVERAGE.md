# ISBD 2021 Coverage Matrix

Audit source: `ISBD_Update 2021 to Consolidated ed 2011.pdf`.

Temporary extraction used for this audit: `/tmp/koha_isbd_2021_audit.txt` generated with `pdftotext`. The extracted text is not tracked.

Classification:

- `automated`: deterministic punctuation normalization exists in `isbd_baseline.json`.
- `partial/handoff`: the plugin records useful MARC context but does not generate the complete ISBD area.
- `guardrail`: the rule pack intentionally warns, blocks, or treats a field as hands-off to avoid unsafe changes.
- `documented manual`: the rule requires cataloger judgment or source inspection and is not safely automatable from a MARC subfield value.
- `gap`: required before release candidate.

| ISBD scope | MARC21/plugin scope | Status | Notes |
| --- | --- | --- | --- |
| General rules A.3.2 prescribed punctuation | `ISBD_SPACING_ALL_001`, `ISBD_AREA_SEPARATOR_001`, `ISBD_DOUBLE_PUNCT_001` | automated | Normalizes spacing, area separators, and double punctuation where a deterministic value can be inferred. |
| Omission of non-applicable areas/elements | MARC field/subfield presence checks | documented manual | The plugin can validate existing fields but cannot decide that an area should exist without cataloging context. |
| Nonroman/right-to-left punctuation alternatives | All fields | documented manual | Script direction and local punctuation policy require cataloger or framework-level control. |
| Area 0 content form, production process, media type | `336`, `337`, `338`, coded/fixed data | partial/handoff | `336` and `337` can inform content form and media type. `338` is carrier type, not ISBD production process. The plugin avoids punctuation edits and does not generate full Area 0 unless a library adds a local production-process mapping. |
| Area 1 title and responsibility | `245$a$b$c$n$p`, selected `246$a` indicators | automated | Covers title/subtitle/responsibility/dependent-title boundary punctuation. Variant title display behavior is indicator-sensitive. |
| Area 1 parallel titles/statements | `245$b`, `250$b`, `490$a` values beginning with `=` | automated/manual | The engine preserves deterministic equals-prefix cases. Detecting all parallel-language groupings remains cataloger judgment. |
| Area 2 edition/version/drafting | `250$a$b` | automated | Terminal periods and additional/parallel edition statement punctuation are deterministic. |
| Area 3 music format | `254$a` | automated | Adds terminal punctuation. |
| Area 3 cartographic mathematical data | `255$a` | automated | Adds terminal punctuation while preserving ratio colons such as `1:25000`. |
| Area 3 cartographic projection/coordinates/equinox/magnitude | `255$b$c$d$e$f$g` | guardrail | Internal coordinate punctuation is too structure-dependent for safe automatic edits. |
| Area 3 serial numbering | `362$a` | automated | Adds terminal punctuation while respecting open-ended hyphenated designations. |
| Area 3 other material-specific fields | `3XX` non-note fields | guardrail | Treated as MARC/material-specific data unless an explicit deterministic rule exists. |
| Area 4 publication/production/distribution | `260/264$a$b$c` | automated | Handles place, publisher, date, repeated places, and interdependent comma/colon punctuation. MARC21 `264` function values are read from the second indicator. |
| Area 4 manufacture/printing details | `260/264$e$f$g` | guardrail | Parenthetical grouping and internal punctuation are not safely inferred from separate subfields. |
| Area 4 copyright | `264` second indicator `4`, `$c` | automated | Removes manufactured ending punctuation while preserving copyright/phonogram symbols. |
| Area 5 physical description | `300$a$b$c$e$f$g` | automated/manual | Covers safe element boundaries and preserves data-dependent endings. Record-context terminal exceptions still require review. |
| Area 6 series and multipart resources | `440/490$a$v$x`, `8XX` | automated/guardrail | Transcribed series boundaries are normalized without manufacturing final `490` punctuation; controlled series tracing fields are hands-off. |
| Area 7 notes | `500`, `502`, `504`, `505`, `520/521`, `530/532/533/534`, `546`, generic `5XX` | automated/guardrail | Simple terminal note punctuation is automated. Structured notes are hands-off where internal syntax varies. |
| Area 8 identifiers and terms | `020`, `022`, `024`, `028`, related standard-number fields | automated | Removes terminal punctuation from standard identifiers and terms of availability where deterministic. |
| Controlled headings/access points | `1XX`, `6XX`, `7XX`, `8XX` | guardrail | Authority and MARC21 heading conventions govern punctuation. |
| Electronic access | `856` | guardrail | URLs and access labels are never punctuation-normalized because edits can break access. |

## Release Candidate Gaps

No release-blocking deterministic punctuation gaps were found in the current audit. Remaining limitations are intentionally classified as `partial/handoff`, `guardrail`, or `documented manual` because they depend on source-of-information review, local cataloging policy, authority control, or structured note semantics.

Known limitation: ISBD 2021 Area 0 production process is not fully represented by MARC21 `338`. Sites that need Area 0 display generation must configure a local mapping and test it as local policy.

Future work should focus on Koha integration smoke testing, not broadening automation into judgment-heavy ISBD decisions.
