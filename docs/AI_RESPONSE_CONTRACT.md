# AI response contract

Each task has a versioned schema in `schema/ai_*_v1.json`. Common response metadata includes `request_id`, `task`, `schema_version`, `status`, `warnings`, and `requires_human_review`.

Statuses are:

- `ok`: structurally valid advisory output is available.
- `insufficient_evidence`: the request succeeded but no defensible answer is available.
- `incomplete`: provider truncation occurred; suggestions are withheld.

`ai_parse_status` records `structured`, `structured_partial`, `degraded_recovery`, `empty`, `malformed`, `truncated`, or `provider_error`. `degraded_mode` and `extraction_source: raw_text` identify recovered output. Diagnostics never include credentials or unbounded provider output.

Classification returns a single candidate with evidence-based `high`, `medium`, `low`, or `insufficient_evidence` confidence. Confidence expresses support from the supplied record and is independent of external verification. Ranges and terminal punctuation are rejected. Complete LC call-number forms, including Cutters, dates, and bounded local suffixes, are retained. Subject candidates preserve explicit `$x`, `$y`, `$z`, and `$v` subdivisions. Model output begins as `unverified`. The server may promote only the classification schedule-existence claim to `verified` after an exact `lccs-2024` schedule/page match.

Classification responses may include `evidence_verification` with `status` (`verified`, `invalid_candidate`, `not_checked`, `no_match`, or `unavailable`), the pinned package source, candidate, validation summary, and bounded matches. `not_checked` means there was no class candidate to verify; `invalid_candidate` distinguishes an unusable candidate from a schedule miss. Non-verified states never turn an advisory candidate into externally supported evidence.

Subject candidates may include a normalized `authority` object with explicit `scheme: LCSH`, status, match type, authorized label, URI, bounded vocabulary evidence, source, and checked time. Authority states are `exact_authorized`, `variant_match`, `close_candidate`, `no_match`, `service_unavailable`, and `invalid_authority_response`. Exact and variant evidence may mark the authority form verified, but never establishes topical relevance; every heading remains review-required. Failure and no-match states preserve the AI candidate as unverified.

Malformed output receives one targeted repair request. After a second failure, the server may recover an explicitly labelled LC class number or subject list. General prose cannot become a subject candidate, and recovery cannot create MARC mutations. The browser projection separates `rationale.ai` from `rationale.system` so a system note is never attributed to the model.
