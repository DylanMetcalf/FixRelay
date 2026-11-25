# ManOp brand

**Name:** ManOp (one word: capital M, capital O; short for *maintenance operations*). **Tagline:** "From reported to resolved." **Descriptor:** "Maintenance operations: requests, job cards and approvals in one place."

ManOp was previously called Resultra and, before that, FixRelay. Colours, typography, layout and voice are unchanged; the name and the symbol changed. Technical identifiers that would break existing sessions or deployments keep their old names on purpose: the session cookie (`fr_session`), environment variables, database and Render service names (`fixrelay…`), and the JSON export format id (`fixrelay-export/2`).

## Wordmark
"Man" in white (on navy) or navy (on light backgrounds) and "Op" in Signal Amber, extra-bold. Always one word, never "Man Op" or "MANOP" in running text.

## Mark
An **M** drawn in three strokes on the navy tile. It starts at a blue dot (*reported*) at the foot of the left stem; the middle of the M is an amber **check** (*resolved*) that runs straight into the right stem: maintenance operations, from report to resolution. Geometric, legible down to 16 px.
Files (editable SVG, 512 × 512 grid, 46 px strokes, round caps):
- `public/brand/manop-mark.svg`: rounded tile (rx 112), the master
- `public/brand/manop-square.svg`: square tile for iOS
- `public/brand/manop-maskable.svg`: Android adaptive icon (symbol inside the 80 % safe zone)
- PNGs generated from the SVGs: `public/favicon-32.png`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `icon-maskable-192/512.png`; `public/icon.svg`; social image `public/brand/og.png` (1200 × 630)
- React: `src/components/logo.tsx` (`<Logo/>`, `<Mark/>`); PDFs draw the same paths (`src/server/pdf/brand.tsx`); guide covers (`scripts/guides/build.cjs`)

Regenerate the PNGs after editing the SVG (command in MANOP_TECHNICAL_HANDOVER.md, section 10).

## Colours
| Token | Hex | Use |
|---|---|---|
| Relay Navy | `#0B1F3A` | App chrome, sidebar, dark sections, icon tile |
| Navy 2 / 3 | `#132B4D` / `#24426E` | Hover and borders on navy |
| Signal Amber | `#F5A524` | Active navigation, primary marketing CTA, "done" |
| Relay Blue | `#1E5AA8` | Default action colour (each company can set its own) |
| Report Blue | `#5B8DEF` | Mark detail only |
| Mist | `#F3F5F8` | Page background |
| Ink | `#111827` | Text |

Amber text is used only on navy (contrast 8.6:1). Company brand colours set button text to black or white automatically for contrast (`src/lib/colour.ts`).

## Voice
Plain, direct, friendly. Say what happens next and who does it. Avoid jargon ("CMMS", "work order lifecycle"). Use South African English spelling (organisation, colour) and rand amounts as `R 1 234.56`.
