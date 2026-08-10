# AI response contract

Each task has a versioned schema in `schema/ai_*_v1.json`. Common response metadata includes `request_id`, `task`, `schema_version`, `status`, `warnings`, and `requires_human_review`.

Statuses are:

- `ok`: structurally valid advisory output is available.
- `insufficient_evidence`: the request succeeded but no defensible answer is available.
- `incomplete`: provider truncation occurred; suggestions are withheld.

Classification returns a single candidate with evidence-based `high`, `medium`, `low`, or `insufficient_evidence` confidence. Ranges and terminal punctuation are rejected. Subject candidates preserve explicit `$x`, `$y`, `$z`, and `$v` subdivisions. Model output is always `unverified` until an external authority connector verifies it.

Malformed output receives one targeted repair request. A second failure returns a structured, display-only degraded response. Regex or prose extraction cannot create a classification, subject, or MARC mutation.
