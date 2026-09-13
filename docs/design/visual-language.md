# Visual language — reference and boundaries

Status: reference captured 2026-09-14. Derived from a landing-page screenshot Kenji supplied
(`clip_20260914_041808_1.png`, 736×1307) of a comic illustrator's studio site.

Everything numeric in this document is extracted from that image, not eyeballed:
palette by `convert <image> -resize 600x -colors 12 histogram:info:-`, contrast by WCAG
relative-luminance maths. Re-run either to check.

## Palette

Sampled by pixel area, so the order approximates how much of the page each colour occupies.

| Hex | Share | Role in the reference | Usable as |
|---|---|---|---|
| `#F8F5F3` | dominant | page background, warm off-white | background |
| `#1A1715` | large | ink: headings, body, dark artwork | text (AAA on background) |
| `#9A2018` | large | primary accent: CTAs, section rules, focal shapes | text, surfaces, buttons |
| `#DDC8B6` | medium | warm tan surface / card fill | surface |
| `#434746` | medium | dark neutral, artwork shadow | text, surface |
| `#A4A09E` | medium | muted grey | **decoration only — see below** |
| `#605C5A` | medium | secondary body text | text (AA on background) |
| `#D0AFA8` | small | dusty rose, soft accent | surface, borders |
| `#572A21` | small | deep maroon, pressed/dark accent | text, surface |
| `#A85D50` | small | terracotta | accent |
| `#A18777` | small | warm taupe, hairlines | borders |
| `#598398` | trace | muted steel blue (appears in artwork) | — |

### Contrast, measured

| Pair | Ratio | Verdict |
|---|---|---|
| `#1A1715` on `#F8F5F3` | 16.43:1 | AAA |
| `#9A2018` on `#F8F5F3` | 7.46:1 | AAA |
| `#F8F5F3` on `#9A2018` (button text) | 7.46:1 | AAA |
| `#434746` on `#F8F5F3` | 8.68:1 | AAA |
| `#572A21` on `#F8F5F3` | 11.00:1 | AAA |
| `#1A1715` on `#DDC8B6` | 11.05:1 | AAA |
| `#605C5A` on `#F8F5F3` | 6.09:1 | AA (not AAA) |
| `#A4A09E` on `#F8F5F3` | **2.39:1** | **fails AA and AA-large** |

Consequences, non-negotiable for this project:

- The muted grey `#A4A09E` is a **decoration colour**: rules, disabled glyphs, dividers. It never carries text, placeholder text included. That is the single most common way this reference will be copied wrong.
- Body copy uses `#1A1715`; secondary copy uses `#605C5A` or darker. `#605C5A` is the lightest text the page may use.
- The crimson works in both directions (text on cream, cream on crimson) at AAA, so it is safe for links, labels and button fills.

## Typography

- **Display**: a bold decorative serif for headings and the logotype — dramatic, high-contrast, slightly condensed. Used large and sparingly.
- **Labels**: the same serif family, all caps at small size with wide letter spacing, for eyebrows and section markers.
- **Body**: a clean neutral sans, three sizes only, generous line height.
- **Numerals**: the process steps use large bold sans numerals (`01`–`04`) as a graphic element, not as a list marker.

Two families total. No third face, no script face.

## Layout and rhythm

- Single column of full-width sections, generous vertical rhythm (roughly 80–100 px between sections at the reference's width), content inside a centred max-width container.
- Cards are flat fills with a thin (1 px) accent border — no shadows, no large radii. The border is the elevation.
- A small solid crimson diamond is the recurring section accent, placed above section titles.
- Repeated devices worth reusing: numbered step grid, split hero (text left / artwork right), full-bleed crimson call-to-action band, minimal three-part footer.

## Boundaries — what this reference is and is not

The screenshot is a **marketing landing page**. The platform's product surfaces are something else entirely.

- **Borrow**: palette, type pairing, spacing rhythm, flat thin-bordered card treatment, the accent-diamond device, the full-bleed accent band.
- **Do not borrow**: its section order, its page structure, its content, or its text. `Comicraft Studio`, `THE LAST REALM`, `SHADOW HUNTER` and the rest are that studio's copy and branding, not ours.
- **Not decided by this reference**: the information architecture of browse, comic detail, the reader, upload, and admin. Those need their own decisions — a landing page and a reading product do not share a layout just because they share a palette.

## Unresolved — needs a decision before any UI work

1. **Does the app UI wear this palette, or only the public landing page?** The catalogue can carry a cream-and-crimson identity; a reading surface usually wants the opposite (near-black, chrome-light, page image dominant).
2. **Reader surface**: a cream background behind comic pages changes how artwork reads and hurts in low light. A dark reader with cream only elsewhere is the conventional answer, but it splits the system in two.

## Mapping sketch (not built)

Tailwind 4 `@theme` tokens, once the two questions above are answered:

```
--color-bg:        #F8F5F3
--color-ink:       #1A1715
--color-accent:    #9A2018
--color-accent-dk: #572A21
--color-surface:   #DDC8B6
--color-line:      #A18777
--color-text-2:    #605C5A
--color-decor:     #A4A09E   /* never text */
```
