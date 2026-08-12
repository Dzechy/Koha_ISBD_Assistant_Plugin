# Plugin Manual

Koha ISBD Cataloging Assistant validates MARC21 bibliographic subfields against a conservative ISBD punctuation rule pack.

## Daily Workflow

1. Open a bibliographic record in Koha staff cataloging.
2. Review inline deterministic findings.
3. Compare current value, expected value, severity, rationale, and patch target.
4. Apply only punctuation-only patches that match the intended subfield occurrence and index.
5. Undo in sandbox/training mode when a patch does not match the cataloging context.

## Boundary Convention

The baseline pack uses prefix-on-current for common `245` title boundaries:

```text
245$a The great Gatsby
245$b  : a novel
245$c  / F. Scott Fitzgerald.
```

Do not place the responsibility slash at the end of `245$b`. Other areas may use suffix-on-previous where that is the deterministic MARC convention, such as `260$b Scribner,` before `$c` and `300$a 180 p. ;` before `$c`.

Subfields may be entered in any UI order. The assistant resolves their declared MARC/ISBD roles before it evaluates dependencies. It does not reorder the saved MARC subfields, and repeated occurrences of the same code keep their original order.

Field `246` and copyright `264` second-indicator `4` do not receive manufactured ending punctuation. Field `490` also has no manufactured final punctuation. Field `300` commonly ends without punctuation; abbreviation points and closing parentheses are preserved.

## Handoff Strategy

The plugin refuses risky automation for authority headings, URLs, control fields, coded fields, complex structured notes, complex cartographic coordinates, and local-policy fields. Area 0 is partial/handoff: production process is not generated from `338`.

## Training

Open **ISBD Training** from the cataloguing toolbar. New trainees complete four onboarding screens before seeing the dashboard. Use **Continue training** to open the recommended lesson, or expand the current module in the learning path and choose an unlocked lesson. Each module has three increasingly difficult lessons and every lesson has at least three scored exercises; assessed practice unlocks the next lesson. The complete path contains 101 exercises.

Lessons combine short explanations, annotated MARC examples, interactive practice, progressive hints, feedback, and reflection. In the MARC lab, edit the tag, indicators, subfield codes, values, and order, then choose **Check answer**. **Show answer** is explicit and records the attempt as revealed, so it cannot award mastery. **Reset** starts a fresh independent attempt.

Course completion and mastery are different. Lessons require correct practice; skills require repeated performance at sufficient difficulty; modules require assessed skill mastery; final certification requires the practical assessment and all prerequisites. Advanced review mode only unlocks navigation.

The curriculum is stored in `Koha/Plugin/Cataloging/AutoPunctuation/rules/intern_guide_v2.json` using schema `4.1.0`. Progress records course, guide, and rules versions. A version change preserves completed work and marks it for review.

Supervisors use **Configuration → Training Progress** to review current module, completion, mastery, weak skills, attempts, failed questions, recommendations, assessment status, and last activity. CSV, JSON, and Excel exports contain the visible supervisor columns.
