# ISBD Alignment Audit

Traceability matrix for the deterministic scope claimed by the plugin.

| ISBD area/section | MARC field scope | Representative rule ID | Status |
| --- | --- | --- | --- |
| A.3.2 prescribed punctuation | `1XX-8XX` text fields | `ISBD_SPACING_ALL_001` | automated |
| A.3.2.3/A.3.2.7 area separators and double punctuation | text fields with explicit separators | `ISBD_AREA_SEPARATOR_001`, `ISBD_DOUBLE_PUNCT_001` | automated |
| Area 0 content form/media type/production process | `336/337/338`, coded data | `ISBD_CONTENT_TYPE_336`, `ISBD_MEDIA_TYPE_337`, `ISBD_CARRIER_TYPE_338` | partial/handoff |
| Area 1 title/responsibility | `245$a$b$c$n$p`, selected `246$a` | `ISBD_TITLE_245A_001`, `ISBD_TITLE_245B_001`, `ISBD_TITLE_245C_001` | automated |
| Area 2 edition | `250$a$b` | `ISBD_EDITION_250A_ALONE`, `ISBD_EDITION_250B_001` | automated |
| Area 3 music/cartographic/serial numbering | `254$a`, `255$a`, `362$a` | `ISBD_MUSICAL_254A_001`, `ISBD_CARTO_255A_001`, `ISBD_SERIAL_362A_001` | automated/guardrail |
| Area 4 publication/manufacture/copyright | `260/264$a$b$c$e$f$g` | `ISBD_PUBL_260A_HAS_B`, `ISBD_PUBL_260B_HAS_C`, `ISBD_PUBL_264_COPYRIGHT_C` | automated/guardrail |
| Area 5 physical description | `300$a$b$c$e$f$g` | `ISBD_PHYS_300A_HAS_C_NO_B`, `ISBD_PHYS_300B_HAS_C`, `ISBD_PHYS_300C_001` | automated |
| Area 6 series | `440/490`, controlled `8XX` | `ISBD_SERIES_490A_HAS_V`, `ISBD_SERIES_8XX_HANDSOFF` | automated/guardrail |
| Area 7 notes | `5XX` | `ISBD_NOTES_500A_001`, generic note rules | automated/guardrail |
| Area 8 identifiers | `020/022/024/028` | `ISBD_ISBN_020`, `ISBD_ISSN_022`, `ISBD_STDNUM_NO_PUNCT_001` | automated |

Area 0 limitation: `338` is carrier type and must not be described as ISBD production process.
