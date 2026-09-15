# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two primary audiences, balanced:
- **Readers** — anyone browsing, searching, and reading comics. Default role on signup (`reader`). Reads are public; saves, ratings, comments, and follows require sign-in.
- **Creators** — approved uploaders who apply, get admin-approved, then publish comics (Comic → Chapter → Page). Reach `creator` only through an approved application, never by signup alone.
- **Admins** — role-gated operators who approve creator applications and take down/suspend violating content via the in-app `/admin` route.

## Product Purpose

A publication platform for comics: creators apply, admins approve, creators upload, readers read. Not a scraper, not an AI generator, not a personal library. v1 is an early public sample — no payments.

## Positioning

Per-comic hybrid access control (`visibility: public | unlisted | private` × `status: draft | published`) enforced by a single `canView(user, comic)` function, so private/comic-page serving never leaks through scattered checks. Content is non-sexual by policy (enforced by report + admin takedown, no NSFW flag exists). Manual, reactive moderation — no auto-classification, no pre-publish queue.

## Operating Context

- Repo `/home/shota/code/lab/comic` → `github.com/farhanreizha/comic` (private).
- Stack (scaffolded via `bun create better-t-stack` v3.43): Svelte web + Hono server + Bun + oRPC + better-auth + Postgres/Prisma + Docker + Biome + Turborepo. i18n via Paraglide (`id` default, `en` fallback, clean URLs, locale from cookie).
- Local-first deploy (WSL + docker compose); VPS later. Postgres on host port **5433** (5432 belongs to another service — never reuse).
- The reader route (`/read/*`) wears its own chrome: the app Header/Footer are intentionally absent there.

## Capabilities and Constraints

- Auth: email + password only (no OAuth, no magic link, no email verification in v1 — anyone can register any address; accepted risk).
- Upload: file-based only (CBZ/ZIP/PDF/multipart images). 200 MB/chapter, 5 MB/image, each a single named constant. Archives are extracted to `Page` rows, never served raw.
- Ingest target: `Comic` → `Chapter` → `Page`; one upload = one chapter.
- Storage: local disk in a Docker volume behind a single `storage` module (`put/get/delete`), so a move to S3/R2 is one file.
- MVP features: auth, upload, reader, shelf, read progress, comments (comic-level), rating 1–5 (comic-level), follow (creator), search (title + creator name ILIKE + genre filter), moderation (report + admin takedown/suspend).
- Genres: fixed 12-value code enum (Action, Adventure, Comedy, Drama, Fantasy, Horror, Mystery, Romance, Sci-Fi, Slice of Life, Sports, Thriller) — code, not a DB table.
- Held out of v1: payments, in-app panel editor, free-form tags.
- All comic read paths (including page images) pass through `canView`.

## Brand Commitments

None stated beyond the product name **comic**. No logo, voice, or visual identity has been declared binding. The existing visual system (cream + crimson editorial tokens in `apps/web/src/app.css`) is incumbent implementation, not a confirmed brand commitment.

## Evidence on Hand

- Decision record: `/home/shota/hermes-vault/Inbox/2026-09-13-comic-project-decisions.md` (21 product decisions, agreed 2026-09-13).
- Incumbent design tokens: `apps/web/src/app.css` (exact hex, measured-contrast system: `#f8f5f3` bg, `#1a1715` ink, `#9a2018` accent, `#572a21` accent-dk, serif display `Fraunces`, sans `Manrope`; reader theme dark `#121110`).
- **Stale pointer:** `app.css` references `docs/design/visual-language.md` as the token source, but that file does not exist in the repo. The tokens in `app.css` are the live truth; the referenced doc should be created or the comment corrected (flagged, not fixed here).
- No testimonials, case studies, press, or marketing assets exist. Do not fabricate any.

## Product Principles

1. Access control is centralized (`canView`), not scattered — a reader's reach is decided in one function and reused everywhere.
2. Moderation is human and reactive, never automated classification; the report button plus admin action is the only removal path.
3. Content stays non-sexual by platform policy; no field, flag, or category for NSFW exists.
4. The reader experience is sacred — it owns its own chrome and dark theme so nothing else competes with the page.
5. Limits and rules are named constants, not magic numbers, so they change in one place.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**. Confirmed constraints from the existing implementation: text controls enforce ≥16px font and ≥28px hit target on touch/narrow viewports (iOS Safari zoom avoidance); `#a4a09e` is decoration-only and never used as text on cream (2.39:1); brand crimson is swapped for `#db6255` in the reader where the primary fails 2.33:1.
