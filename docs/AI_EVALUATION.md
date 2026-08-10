# AI evaluation

The deterministic evaluation fixture is `tests/fixtures/ai_evaluation_cases.json`. It records the input, task, deterministic rule where applicable, acceptable interpretation, known ambiguity, expected authority status, and expected human-review status.

`tests/ai_subsystem_regression.pl` covers task normalization, ordered context/cache behavior, prompt injection boundaries, prompt limits, schemas, parsing failures, truncation, classification and subdivision semantics, capability selection, and patch guardrails. Live provider evaluation is intentionally separate because it requires configured credentials and incurs external cost.

Model evaluation should report schema compliance, parser success, factual agreement, deterministic-rule agreement, unsupported authority claims, false confidence, unsafe patch attempts, and appropriate human-review detection. A non-empty answer is not a success criterion. `insufficient_evidence` is an acceptable and often preferred outcome.
