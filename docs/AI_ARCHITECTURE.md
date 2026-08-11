# AI architecture

The AI subsystem is advisory. Browser code sends an explicit task to `ai_suggest` through one canonical plugin API client; it never receives provider credentials and never calls OpenAI or OpenRouter. The server normalizes MARC context, selects semantically related fields, builds a bounded prompt, invokes the provider adapter, validates the task schema and semantics, applies deterministic guardrails, and returns a provider-independent, trust-labelled result.

The supported tasks are `punctuation_explanation`, `cataloging_classification`, `subject_heading_suggestion`, `cataloging_review`, and `training_tutor`. Their provider response contract remains `1.0.0`; the prompt version is `3.0.0`, and the independently versioned browser projection is `2.1.0`.

`AI::Provider::generate(settings, task, context, schema, options)` is the single provider interface. Options contain the system policy. OpenAI uses Responses; OpenRouter uses Chat Completions. Model parameters are selected by `rules/ai_model_capabilities.json`, not guessed from substrings. Unknown models use strict textual JSON and the validated fallback path until an administrator adds a verified registry entry or supplies `ai_model_capabilities`.

The AI generation cache stores canonical provider results, never browser payloads. Cache hits therefore pass through current verification and browser projection. Its key includes task, schema and prompt versions, rules version, provider/model, tag, indicators, field occurrence, ordered subfields, normalized record context, feature flags, context mode, user scope, redaction settings, prompt length, temperature, reasoning effort, and capability overrides.

After provider schema validation, classification candidates pass through `AI::LCCS`. Its bounded Node helper reads the bundled, exact `lccs-2024@1.1.0` package and tests the longest exact schedule prefix represented by a complete call number, requiring an exact code plus page-level subclass marker before returning schedule evidence. A verified match enriches the result with source PDF, page, caption, validation metadata, and `authority_status: verified`. Verification is deliberately non-gating: invalid syntax, no candidate, no match, a missing Node runtime, or unavailable package remains an explicit state and does not invent schedule support.

Punctuation fixes originate only in the deterministic rules engine. AI may explain a deterministic finding but cannot return an applicable MARC mutation.

Subject candidates pass through `AI::LinkedData::LOC`. The adapter queries the fixed HTTPS LCSH `suggest2` endpoint, normalizes authorized labels, variants, relationships, source versions, and controlled subject URIs, and returns `exact_authorized`, `variant_match`, `close_candidate`, `no_match`, `service_unavailable`, or `invalid_authority_response`. Exact and variant matches establish controlled-vocabulary evidence, not relevance to the resource. Complete constructed headings are verified only when LOC returns an exact record for the complete string.

LOC results use the separate `AI::AuthorityCache`, keyed by scheme, normalized query, and adapter version. Transient service failures and malformed responses are not cached. LOC failures are isolated from the AI provider circuit breaker, and authority checks can be retried without regenerating AI output.

Structured JSON is primary. After one repair failure, `AI::Parse` may recover only explicit LC class numbers or explicitly labelled subject lists. Recovery is server-side and marked `degraded_recovery`, `raw_text`, unverified, and review-required. Malformed, empty, truncated, and provider failures remain distinct states.

Live editor input performs only cheap bookkeeping. Field validation and AI-panel projection are debounced, identical validation/render fingerprints are skipped, full catalogue context is constructed only for an explicit AI request or payload preview, and request cancellation remains independent of typing. Development performance counters record input, validation, guardrail, context-construction, and DOM-render duration.

The training tutor is optional and does not participate in scoring. The deterministic training engine evaluates answers, records attempts, calculates mastery, and controls certification. AI receives only bounded exercise/curriculum context and can provide an explanation or progressive hint; it cannot mark an answer correct, unlock a module, or award mastery.
