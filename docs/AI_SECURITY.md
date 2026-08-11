# AI security

API keys and provider requests are server-side. The browser calls only the Koha plugin endpoint. Staff authentication and CSRF checks run before AI work.

Bibliographic content is untrusted. Prompt delimiters, escaping, and system policy prevent titles, notes, names, and URLs from changing the task. Debug output is administrator-controlled, length-limited, and redacts API keys, tokens, secrets, and authorization headers. Full bibliographic payloads are not logged.

AI output cannot contain raw MARC mutations. For punctuation, the rules engine produces the patch and the AI may only explain the deterministic finding. Classification and subject output requires human review. Only deterministic LCCS evidence can verify a schedule match, and only the server-side LOC adapter can verify an LCSH authority record; the AI cannot promote its own claim.

Transport, timeout, rate-limit, and temporary provider failures are retryable with controlled backoff. Non-retryable client errors are returned immediately. Invalid structured output is repaired once; semantic invalidity is withheld rather than blindly retried. Truncated output becomes `incomplete`.

LOC authority data is external and untrusted. The adapter uses only fixed `https://id.loc.gov/authorities/subjects/` endpoints, explicit timeouts, bounded candidate/result counts, and machine-readable JSON. It never fetches a model-supplied arbitrary URL. Authority URIs are validated against the controlled subject URI pattern before dereferencing. LOC 404, 429, timeout/server failure, and malformed payloads remain distinct and do not trip the AI provider circuit.
