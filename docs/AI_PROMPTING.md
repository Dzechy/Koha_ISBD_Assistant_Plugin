# AI prompting

Prompts have four boundaries: a system policy, task instructions, catalogue context, and relevant deterministic findings. Output shape is supplied as JSON Schema by the provider adapter when the selected model is registered as supporting structured output.

MARC data is rendered with tag, indicators, field occurrence, ordered subfield indices, codes, exact values, and active subfield. It is enclosed in `<catalogue_data>`. Angle brackets in values are escaped, and the system policy says that catalogue content is data rather than instructions.

Context modes are `tag_only`, `tag_plus_related_fields`, and `full_record`. Related fields are selected by bibliographic relevance rather than DOM adjacency. Classification, subject-heading, and cataloguing-review tasks always use a bounded `tag_plus_related_fields` policy even when the global field-assist setting is `tag_only`; punctuation assistance retains the configured mode. `ai_prompt_max_length` reserves space for task and output instructions, prioritizes bibliographic identity, publication, physical description, notes, and controlled/access points, and discards lower-priority context first.

Cataloguing prompts permit professional inference from whatever evidence is supplied. Missing MARC fields reduce confidence or specificity; they are not negative evidence and do not form a fixed field checklist. The model must distinguish explicit record evidence from inference, avoid fabricated facts or verification claims, and return `insufficient_evidence` only when no defensible candidate can be supported.

Configured cataloguing policy text is bounded and included as a site-level prompt component; catalogue values remain inside the untrusted-data boundary. Server system policy and the task schema always govern the request. Cataloguing prompts prohibit invented LCSH identifiers/URIs, LCC schedule citations, claims of LOC/LCCS verification, and direct MARC mutation.

For `training_tutor`, the browser sends a bounded learner-request object containing the tutor mode, optional question, curriculum/rule context, and `do_not_reveal_answer`. It is rendered outside catalogue data but is still labelled untrusted. Tutor instructions require curriculum-grounded teaching, progressive no-answer hints when requested, no MARC mutation, and a clear distinction between deterministic rules, authoritative sources, and cataloguer judgment.
