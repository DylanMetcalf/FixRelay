# FixRelay brand

**Name:** FixRelay (one word, capital F and R). **Tagline:** "From fault reported to job completed."

## Mark
The mark is a route that forms an **F**: it starts at a blue dot (*fault reported*), rises and turns, and ends in an amber check (*job completed*): the job being relayed from report to sign-off.
Files: `public/brand/fixrelay-mark.svg` (rounded tile), `fixrelay-maskable.svg` (Android adaptive icon, safe zone), `fixrelay-square.svg` (iOS), PNGs in `public/`, social image `public/brand/og.png`. React: `src/components/logo.tsx` (`<Logo/>`, `<Mark/>`).

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
