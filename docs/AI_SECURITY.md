# AI security

API keys and provider requests are server-side. The browser calls only the Koha plugin endpoint. Staff authentication and CSRF checks run before AI work.

Bibliographic content is untrusted. Prompt delimiters, escaping, and system policy prevent titles, notes, names, and URLs from changing the task. Debug output is administrator-controlled, length-limited, and redacts API keys, tokens, secrets, and authorization headers. Full bibliographic payloads are not logged.

AI output cannot contain raw MARC mutations. For punctuation, the rules engine produces the patch and the AI may only explain the deterministic finding. Classification and subject output remains unverified and requires human review.

Transport, timeout, rate-limit, and temporary provider failures are retryable with controlled backoff. Non-retryable client errors are returned immediately. Invalid structured output is repaired once; semantic invalidity is withheld rather than blindly retried. Truncated output becomes `incomplete`.
