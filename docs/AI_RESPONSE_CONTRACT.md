# AI response contract

Each task has a versioned schema in `schema/ai_*_v1.json`. Common response metadata includes `request_id`, `task`, `schema_version`, `status`, `warnings`, and `requires_human_review`.

Statuses are:

- `ok`: structurally valid advisory output is available.
- `insufficient_evidence`: the request succeeded but no defensible answer is available.
- `incomplete`: provider truncation occurred; suggestions are withheld.

`ai_parse_status` records `structured`, `structured_partial`, `degraded_recovery`, `empty`, `malformed`, `truncated`, or `provider_error`. `degraded_mode` and `extraction_source: raw_text` identify recovered output. Diagnostics never include credentials or unbounded provider output.

Classification returns a single candidate with evidence-based `high`, `medium`, `low`, or `insufficient_evidence` confidence. Ranges and terminal punctuation are rejected. Subject candidates preserve explicit `$x`, `$y`, `$z`, and `$v` subdivisions. Model output begins as `unverified`. The server may promote only the classification schedule-existence claim to `verified` after an exact `lccs-2024` schedule/page match.

Classification responses may include `evidence_verification` with `status` (`verified`, `no_match`, or `unavailable`), the pinned package source, candidate, validation summary, and bounded matches. `no_match` and `unavailable` never remove an otherwise valid AI candidate: it remains visible, unverified, advisory, and subject to human review.

Subject candidates may include a normalized `authority` object with explicit `scheme: LCSH`, status, match type, authorized label, URI, bounded vocabulary evidence, source, and checked time. `no_match`, `service_unavailable`, and `invalid_authority_response` preserve the AI candidate as unverified. A verified heading remains review-required.

Malformed output receives one targeted repair request. After a second failure, the server may recover an explicitly labelled LC class number or subject list. General prose cannot become a subject candidate, and recovery cannot create MARC mutations. The browser projection separates `rationale.ai` from `rationale.system` so a system note is never attributed to the model.
