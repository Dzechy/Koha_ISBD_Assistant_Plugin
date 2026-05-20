# Known Limitations

The plugin is deterministic punctuation assistance, not a full cataloging authority.

- Area 0 is partial/handoff. `336` can inform content form and `337` can inform media type, but `338` is carrier type and is not ISBD production process. Production process requires a disabled-by-default local mapping if a library chooses to configure one.
- Authority headings and access points (`1XX`, `6XX`, `7XX`, controlled `8XX`) are not automatically normalized.
- URLs and electronic access fields (`856`) are not punctuation-normalized because edits can break access.
- Control fields, fixed fields, and coded fields are treated as handoff data.
- Complex cartographic coordinate/projection subfields remain manual.
- Structured notes such as contents, reproduction, and linking notes may require local practice and source review.
- Local `9XX` fields are excluded unless a site explicitly enables local-field rules.
- AI output is advisory only. Deterministic findings and local cataloging policy govern patches.
