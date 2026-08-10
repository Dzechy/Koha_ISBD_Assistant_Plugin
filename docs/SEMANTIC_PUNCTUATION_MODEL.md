# Semantic Punctuation Model

The deterministic engine treats MARC storage order and bibliographic presentation order as separate concerns. The UI and serializers preserve the field tag, indicators, field occurrence, physical subfield array, repeated fields, and repeated subfield occurrence order. Punctuation validation and ISBD rendering resolve unlike subfield codes through an explicit semantic model.

## Relationship declarations

`isbd_baseline.json` has a top-level `field_relationships` object. Each audited field declares a role and numeric `canonical_position` for its supported subfields. For example, `245$a`, `$b`, `$n`, `$p`, and `$c` are title proper, other title information, part number, part name, and statement of responsibility. Their canonical positions determine presentation and dependency direction even when the DOM contains `$c`, `$b`, `$a`.

The model currently covers `245`, `250`, `255`, `260`, `264`, `300`, `440`, and `490`. A legacy or custom rule for a field without a declaration retains physical-order behavior for compatibility. New multi-subfield rules must add a relationship declaration.

Different subfield codes use their canonical positions. Repeated occurrences of the same code use their physical sequence because their occurrence order can be meaningful. Empty values are absent for relationship and repeat-policy checks.

## Processing pipeline

The public JavaScript engine follows one deterministic path:

```text
raw MARC field
  -> attach relationship model
  -> evaluate presence/repeat/indicator guardrails
  -> resolve semantic prefix and suffix dependencies
  -> emit target-indexed findings and safe patches
  -> normalize a copy while preserving MARC structure
  -> sort a presentation copy only when rendering ISBD text
```

`normalizeField` and `normalizeRecord` do not reorder stored subfields. `semanticSubfields` creates a presentation-only ordering, and `renderField` renders that copy. `serializeField` and `serializeRecord` remove internal punctuation provenance before a raw MARC representation is persisted. Koha's actual form save naturally has the same separation because provenance lives in a `WeakMap`, not in the input value. The Perl validator mirrors the same relationship resolution for server-side checks and AI guardrails.

`subfield_index` remains important, but only as the identity of a patch target. It must never be interpreted as “bibliographically previous” or “bibliographically next.” The active UI subfield is carried separately and does not cause the context array to be reordered.

## Boundary punctuation

A rule can place a boundary on either related element. `when_preceding_subfields`, `when_following_subfields`, `prefix_mode`, `suffix_mode`, and the code-specific prefix/suffix maps are resolved semantically. Before a mark is added, the engine checks the related element for the same mark so one colon, semicolon, comma, slash, equals sign, or plus sign is not represented on both sides of a boundary.

The baseline deliberately remains conservative. It does not use a universal trailing-period removal rule. Abbreviations, initials, ellipses, parentheses, question marks, and exclamation marks can be catalogued data.

## Punctuation provenance

When a deterministic patch adds a prefix or suffix, its finding carries:

```json
{
  "source": "plugin",
  "value": "the exact patched value",
  "generated_prefix": " : ",
  "generated_suffix": ""
}
```

The UI keeps this metadata in a `WeakMap` keyed by the live input and includes it in later validation only while `value` still equals the live value. Manual or AI edits clear it. The request schemas and Perl guardrail accept the same shape. This lets the `245$b` rule remove a plugin-generated final point after a related `245$c` appears without treating every period as generated.

For older values without provenance, `245$b` uses a narrow deterministic fallback. It preserves ellipses, single-letter initials, and a small abbreviation set such as `ed.`, `Dr.`, and `Jr.`. An explicit non-plugin provenance source is always preserved. Ambiguous punctuation should be left for cataloger review.

## Idempotency

Normalization first recognizes already-present prescribed punctuation. Provenance is retained only when it still matches the current value. Reprocessing the normalized field therefore produces no further punctuation changes. Save/reload tests JSON-serialize a normalized record, reload it, normalize it again, and require byte-equivalent data.

## Guardrails and AI

Presence requirements and exclusions are evaluated against active semantic elements. The server selects an explicit `active_subfield`; if one is absent, it chooses the canonical semantic element rather than array element zero. AI cache text is canonicalized by relationship position, while the payload retains physical ordering so patch indices remain valid. Deterministic rules remain authoritative over AI punctuation patches.

## Adding or changing a rule

1. Confirm the MARC 21 input convention and the applicable ISBD element relationship.
2. Add or update the field relationship declaration.
3. Put the boundary on one side and coordinate the other side through semantic dependency fields.
4. Use exact punctuation lists; do not strip all punctuation.
5. Add JavaScript and Perl examples for canonical and reversed input order.
6. Programmatically permute all unlike important subfields.
7. Test repeated same-code occurrences separately.
8. Test intrinsic punctuation and plugin provenance.
9. Assert normalization idempotency and save/reload stability.
10. Run every command listed in the audit report.
