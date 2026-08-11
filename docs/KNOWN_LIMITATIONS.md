# Known Limitations

The plugin is deterministic punctuation assistance, not a full cataloging authority.

- Area 0 is partial/handoff. `336` can inform content form and `337` can inform media type, but `338` is carrier type and is not ISBD production process. Production process requires a disabled-by-default local mapping if a library chooses to configure one.
- AI-generated `650` subject candidates can receive LCSH evidence from the Library of Congress Linked Data Service. This does not replace Koha's authority-linking workflow, does not silently write `$0`/`$2`, and does not verify other `1XX`, `6XX`, `7XX`, or controlled `8XX` access points.
- LOC availability and rate limits are external dependencies. Cached evidence and authority-only retry reduce repeated requests, but an outage leaves suggestions explicitly unverified.
- URLs and electronic access fields (`856`) are not punctuation-normalized because edits can break access.
- Control fields, fixed fields, and coded fields are treated as handoff data.
- Complex cartographic coordinate/projection subfields remain manual.
- Field `255` receives only safe outer boundary/terminal handling; its coordinate, equinox, and G-ring syntax still requires cataloger review.
- Field `300` terminal punctuation can depend on record context (including the presence of a `490`). Field-level checks conservatively avoid manufacturing a period; catalogers must review record-level exceptions.
- Structured notes such as contents, reproduction, and linking notes may require local practice and source review.
- Local `9XX` fields are excluded unless a site explicitly enables local-field rules.
- AI output is advisory only. Deterministic findings and local cataloging policy govern patches.
- Training progress is available locally in the browser and synchronizes to plugin storage when the authenticated Koha progress endpoint is reachable. Cross-device continuation and supervisor reporting require successful server synchronization.
- The optional AI tutor requires configured AI access. Training lessons, deterministic feedback, hints, scoring, mastery, and certification remain available without AI.
