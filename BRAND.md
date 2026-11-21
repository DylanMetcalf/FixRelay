# Resultra brand

**Name:** Resultra (one word, capital R). **Tagline:** "From reported to resolved." **Descriptor:** "Maintenance requests, job cards and approvals in one place."

Resultra was previously called FixRelay. The colours, typography, layout and voice are unchanged; only the name and the symbol changed. Technical identifiers that would break existing sessions or deployments keep their old names on purpose: the session cookie (`fr_session`), environment variables, database and Render service names, and the JSON export format id (`fixrelay-export/2`).

## Mark
An **R** whose leg becomes a **check**. It starts at a blue dot (*reported*) at the foot of the stem and finishes in an amber check (*resolved*): one continuous line from report to resolution. Geometric, two strokes on the navy tile, legible down to 16 px.
Files (editable SVG, 512 × 512 grid, 46 px strokes with round caps):
- `public/brand/resultra-mark.svg`: rounded tile (rx 112), the master
- `public/brand/resultra-square.svg`: square tile for iOS
- `public/brand/resultra-maskable.svg`: Android adaptive icon (symbol inside the 80 % safe zone)
- PNGs generated from the SVGs: `public/favicon-32.png`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `icon-maskable-192/512.png`; `public/icon.svg`; social image `public/brand/og.png` (1200 × 630)
- React: `src/components/logo.tsx` (`<Logo/>`, `<Mark/>`); PDF documents draw the same paths (`src/server/pdf/brand.tsx`)

Regenerate the PNGs after editing the SVG: `node -e "..."` with sharp (see TECHNICAL notes in RESULTRA_TECHNICAL_HANDOVER.md).

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
