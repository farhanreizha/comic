---
name: comic
description: Editorial comic publishing platform — cream paper, crimson accent, restrained flat borders, reader-first.
colors:
  primary: "#9a2018"
  primary-deep: "#572a21"
  neutral-bg: "#f8f5f3"
  neutral-surface: "#ddc8b6"
  neutral-line: "#a18777"
  neutral-ink: "#1a1715"
  neutral-text-2: "#605c5a"
  decorative: "#a4a09e"
  rose: "#d0afa8"
  steel: "#598398"
  reader-bg: "#121110"
  reader-chrome: "#1a1715"
  reader-ink: "#f8f5f3"
  reader-decor: "#a4a09e"
  reader-accent: "#db6255"
typography:
  display:
    fontFamily: "\"Fraunces\", ui-serif, Georgia, serif"
    fontWeight: 700
    letterSpacing: "normal"
  body:
    fontFamily: "\"Manrope\", ui-sans-serif, system-ui, sans-serif"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "\"Fraunces\", ui-serif, Georgia, serif"
    fontWeight: 700
    letterSpacing: "0.18em"
    textTransform: "uppercase"
rounded:
  sm: "4px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-bg}"
    rounded: "{rounded.sm}"
    padding: "8px 20px"
    typography: "label"
  button-primary-hover:
    backgroundColor: "{colors.primary-deep}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-text-2}"
    rounded: "{rounded.sm}"
    padding: "8px 20px"
    typography: "label"
  button-secondary-hover:
    textColor: "{colors.primary}"
---

# Design System: comic

## Overview

**Creative North Star: "The Editorial Reading Room"**

comic is a comic publishing platform where the reading experience is the room and everything else is quiet furniture. The visual system is an editorial print metaphor rendered for screen: warm cream paper, a single crimson voice, and a refined serif (Fraunces) carrying titles while a clean sans (Manrope) handles the body. Nothing competes with the page. Depth is suggested by hairline borders and tonal shifts, never by shadows — the surfaces are flat and confident, like a well-set magazine spread.

The system is **restrained and editorial**: accent crimson appears sparingly, reserved for the primary action and the occasional emphasis, while thin `line`-colored borders do the structural work. Density is calm; sections breathe with generous spacing. The reader route (`/read/*`) intentionally drops all app chrome and switches to a separate dark theme so the comic page is the only thing on screen.

**Key Characteristics:**
- Cream paper background (`#f8f5f3`) with a single crimson accent (`#9a2018`); accent is rare by design.
- Flat, border-driven depth — no shadows; `border-line` hairlines define structure.
- Fraunces (serif) for display + eyebrow labels, Manrope (sans) for body and UI.
- The recurring solid crimson diamond marks section titles.
- A dedicated dark reader theme that strips app chrome entirely.
- WCAG 2.1 AA is a hard constraint: `#a4a09e` is decoration-only, never text on cream.

## Colors

A warm cream-and-crimson editorial palette. Crimson is the only chromatic voice in the light theme; everything else is paper, ink, and tonal neutrals. A separate, darker reader palette keeps the same restraint on a near-black ground.

### Primary
- **Crimson** (`#9a2018`): the single accent. Primary buttons, the diamond marker, active/focus borders, links on hover, and report/emphasis text. Used sparingly — it marks, it does not fill.
- **Rust** (`#572a21`): crimson's deep hover/active state for primary buttons and accents that need to recede slightly.

### Neutral
- **Cream** (`#f8f5f3`): page background and button text-on-accent. The paper.
- **Sand** (`#ddc8b6`): surface fill for cards, panels, and cover placeholders — a warm mid-tone that lifts content off the paper without a shadow.
- **Taupe Line** (`#a18777`): hairline borders and dividers. The structural workhorse.
- **Ink** (`#1a1715`): primary text and headings. Near-black, warm.
- **Muted Ink** (`#605c5a`): secondary text — bylines, metadata, helper copy.
- **Decorative** (`#a4a09e`): decoration ONLY. Never text on cream (2.39:1 fails AA); used for the cover-fallback diamond backing and reader decor.

### Supporting (sparing use)
- **Rose** (`#d0afa8`): soft warm tint, occasional secondary surface/tint.
- **Steel** (`#598398`): cool accent reserved for non-crimson emphasis if ever needed.

### Named Rules
**The One Voice Rule.** Crimson is the only chromatic accent in the light theme and appears on ≤10% of any screen. Its rarity is the point — when it shows, it means "this is the action." Reserved decorative neutrals (`#a4a09e`) never carry text.

**The Reader Swap Rule.** In `/read/*`, the brand crimson (`#9a2018`) fails 2.33:1 on the dark ground, so it is swapped for **Reader Crimson** (`#db6255`), which meets AA there. The dark reader palette (`#121110` bg, `#1a1715` chrome, `#f8f5f3` ink) replaces the cream system wholesale; no app header or footer appears.

## Typography

**Display Font:** Fraunces (with Georgia, serif fallback)
**Body Font:** Manrope (with system-ui, sans-serif fallback)
**Label/Mono Font:** Fraunces, used for eyebrows/labels in all-caps wide tracking.

**Character:** A literary serif paired with a neutral grotesque. Fraunces gives the platform its editorial, print-shop personality in titles and section labels; Manrope keeps the reading UI quiet and legible. The contrast is the brand: expressive headings, invisible body.

### Hierarchy
- **Display** (Fraunces, 700, clamp ~1.5–2.25rem / 24–36px, tight leading): comic titles, page H1s.
- **Headline** (Fraunces, 700, ~1.25rem / 20px): section titles within a page.
- **Title** (Manrope, 600, ~1rem / 16px): card titles, list items, button labels.
- **Body** (Manrope, 400, 0.875rem / 14px, line-height 1.6): paragraphs, metadata, form text. Max line length ~65–75ch in prose blocks.
- **Label / Eyebrow** (Fraunces, 700, 0.72rem / ~11.5px, letter-spacing 0.18em, uppercase): section eyebrows, the recurring "section marker" treatment above titles.

### Named Rules
**The Eyebrow Rule.** Every section title is preceded by an uppercase Fraunces eyebrow (0.72rem, 0.18em tracking, crimson). It is the system's signature label treatment — never Manrope, never lowercase.

## Layout

Single centered column framed by a max-width container (`max-w-6xl`, ~72rem) with `px-4` gutters. The app shell is a CSS grid: auto header, `1fr` main, auto footer, with `min-w-0` on main so long content (titles, covers) cannot inflate the track past the viewport (a fixed BUG-2 regression guard). The reader route bypasses this shell entirely.

Responsive: browse grids step `grid-cols-2` (mobile) → `grid-cols-4` (≥sm). Header nav collapses to a horizontally scrollable row (`overflow-x-auto`) below `sm` so it never stretches the header's min-content. Touch/narrow viewports enforce ≥16px control font and ≥28px hit targets (40px for file inputs) to avoid iOS Safari zoom and meet AA.

## Elevation & Depth

This system is **flat by default**. There are no shadows anywhere; depth is conveyed entirely through `border-line` hairlines and tonal fills (Cream paper → Sand surface). Hover states shift border color toward Crimson or fill a surface lightly — they do not lift or cast. The single exception to "no elevation" is the sticky header, which uses `bg-bg/95` + `backdrop-blur` to stay legible over scrolling content, not a drop shadow.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Borders (never shadows) separate and define. State changes are communicated by border-color and fill shifts, not by elevation.

## Shapes

Corners are gently rounded and consistent: the system radius is `4px` (`rounded`, the Tailwind default), applied to buttons, inputs, chips, and cards alike. No sharp corners, no pill radii — a quiet, bookish softness. Borders are 1px `border-line` hairlines on inputs, chips, cards, and panels. The one recurring geometry is the **solid crimson diamond** (a 2px rotated square, `.diamond`) that sits above section titles as a marker.

## Components

### Buttons
- **Shape:** gently rounded (4px).
- **Primary:** crimson fill (`bg-accent`), cream text; hover → Rust (`bg-accent-dk`). Padding `8px 20px`, label typography (Manrope 600, small).
- **Secondary:** transparent, `text-text-2`, 1px `border-line`; hover → crimson text + crimson border. Same padding.
- **Ghost:** `text-text-2`, no border; hover → crimson text only.
- **Focus:** `focus-visible:ring-2 ring-accent/60` (crimson focus ring), no outline. Disabled → `opacity-60`, not-allowed cursor.

### Chips (genre tags)
- **Style:** 1px `border-line`, no fill, `text-text-2`, uppercase 0.65rem Fraunces-ish label with wide tracking. Used for genre tags on cards and the comic detail page.
- **State:** in filter/edit contexts a selected chip takes crimson border + crimson text; unselected stays neutral with a crimson-on-hover affordance.

### Cards / Containers (ComicCard, panels)
- **Corner Style:** 4px radius on the cover frame.
- **Background:** cover frame is `bg-surface` (Sand) behind the image; panels/manage boxes use `bg-surface` or transparent with `border-line`.
- **Shadow Strategy:** none (Flat-By-Default). Definition comes from the `border-line` frame.
- **Border:** 1px `border-line` around the cover; hover → crimson border (`group-hover:border-accent`).
- **Internal Padding:** panels use `p-3`; page-level sections use `py-8` / `mt-10` rhythm.
- **Cover aspect:** strict `2/3` portrait; images `object-cover`, `loading="lazy"`; missing cover shows the crimson diamond on Sand.

### Inputs / Fields
- **Style:** full-width, 1px `border-line`, Cream fill, `p-2`, body text (`text-sm`, ink). Selects use `px-2 py-1`.
- **Focus:** border shifts to crimson (`focus-visible:border-accent`), no glow, no shadow.
- **Error:** message in crimson below the field, `role="alert"`; field keeps its border (no red border in the current impl — error is text-only).
- **Disabled:** `text-decor` (the decoration-only neutral), not crimson.

### Navigation (Header)
- **Style:** sticky top, `border-b border-line`, Cream at 95% opacity + backdrop blur. Brand wordmark "komi**k**" sets "k" in crimson.
- **Typography:** nav links are Manrope 600, `text-text-2`; hover → `bg-surface/60` tint + ink.
- **Mobile:** nav becomes a horizontally scrollable row; never wraps to inflate header.
- **Active/Auth:** signed-in shows Library/Upload (creator+), Admin (admin), Sign out; signed-out shows Sign in / Sign up (crimson fill).

### Footer
- **Style:** `border-t border-line`, Cream bg, `text-text-2`, small. Two-row stack on mobile, row-between on ≥sm. No shadow, no fill.

## Do's and Don'ts

### Do:
- **Do** keep crimson rare — reserve it for the primary action, the diamond marker, and hover/active emphasis.
- **Do** use `border-line` hairlines (not shadows) to separate and define surfaces.
- **Do** precede every section title with the uppercase Fraunces crimson eyebrow.
- **Do** enforce ≥16px control font and ≥28px hit targets on touch/narrow viewports.
- **Do** swap to the dark reader theme (`#db6255` accent on `#121110`) inside `/read/*` and strip all app chrome there.

### Don't:
- **Don't** use `#a4a09e` (Decorative) as text on cream — it fails AA (2.39:1); it is decoration only.
- **Don't** introduce box-shadows or elevation to "lift" cards/buttons; depth is border- and tone-driven.
- **Don't** let long titles or covers stretch the layout past the viewport — keep `min-w-0` on the main track.
- **Don't** use brand crimson (`#9a2018`) on the dark reader ground; it fails 2.33:1 — use Reader Crimson `#db6255`.
- **Don't** replace the Fraunces/Manrope pairing or the cream/crimson palette without revisiting this system.
