# AI prompting

Prompts have four boundaries: a system policy, task instructions, catalogue context, and relevant deterministic findings. Output shape is supplied as JSON Schema by the provider adapter when the selected model is registered as supporting structured output.

MARC data is rendered with tag, indicators, field occurrence, ordered subfield indices, codes, exact values, and active subfield. It is enclosed in `<catalogue_data>`. Angle brackets in values are escaped, and the system policy says that catalogue content is data rather than instructions.

Context modes are `tag_only`, `tag_plus_related_fields`, and `full_record`. Related fields are selected by bibliographic relevance rather than DOM adjacency. `ai_prompt_max_length` reserves space for task and output instructions, keeps the target field first, and discards lower-priority context first. Limited prompts explicitly prohibit inference from absent data.

Custom legacy prompt text is not an authority boundary. Server system policy and the task schema always govern the request.

For `training_tutor`, the browser sends a bounded learner-request object containing the tutor mode, optional question, curriculum/rule context, and `do_not_reveal_answer`. It is rendered outside catalogue data but is still labelled untrusted. Tutor instructions require curriculum-grounded teaching, progressive no-answer hints when requested, no MARC mutation, and a clear distinction between deterministic rules, authoritative sources, and cataloguer judgment.
