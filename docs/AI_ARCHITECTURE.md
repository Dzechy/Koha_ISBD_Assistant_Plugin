# AI architecture

The AI subsystem is advisory. Browser code sends an explicit task to `ai_suggest`; it never receives provider credentials and never calls OpenAI or OpenRouter. The server normalizes MARC context, selects semantically related fields, builds a bounded prompt, invokes the provider adapter, validates the task schema and semantics, applies deterministic guardrails, and returns a trust-labelled result.

The supported tasks are `punctuation_explanation`, `cataloging_classification`, `subject_heading_suggestion`, `cataloging_review`, and `training_tutor`. Their response contract version is `1.0.0`; the prompt version is `2.0.0`.

`AI::Provider::generate(settings, task, context, schema, options)` is the single provider interface. Options contain the system policy. OpenAI uses Responses; OpenRouter uses Chat Completions. Model parameters are selected by `rules/ai_model_capabilities.json`, not guessed from substrings. Unknown models use strict textual JSON and the validated fallback path until an administrator adds a verified registry entry or supplies `ai_model_capabilities`.

Cache keys include task, schema and prompt versions, rules version, the pinned LCCS evidence version, provider/model, tag, indicators, field occurrence, ordered subfields, normalized record context, feature flags, context mode, user scope, redaction settings, prompt length, temperature, reasoning effort, and capability overrides.

After provider schema validation, classification candidates pass through `AI::LCCS`. Its bounded Node helper reads the bundled, exact `lccs-2024@1.1.0` package and requires an exact code plus page-level subclass marker before returning schedule evidence. A verified match enriches the result with source PDF, page, caption, validation metadata, and `authority_status: verified`. Verification is deliberately non-gating: no match, a missing Node runtime, or unavailable package preserves the valid AI candidate as `unverified` and adds a review warning.

Punctuation fixes originate only in the deterministic rules engine. AI may explain a deterministic finding but cannot return an applicable MARC mutation.

The training tutor is optional and does not participate in scoring. The deterministic training engine evaluates answers, records attempts, calculates mastery, and controls certification. AI receives only bounded exercise/curriculum context and can provide an explanation or progressive hint; it cannot mark an answer correct, unlock a module, or award mastery.
