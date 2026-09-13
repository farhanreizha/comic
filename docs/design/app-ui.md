# App UI — information architecture and requirements

Status: IA decided 2026-09-14 (session answers Q1–Q4). Handoff sequence at the end is proposed, not yet confirmed.
Companion docs: `docs/design/visual-language.md` (palette, type, contrast floor), `docs/design/reading-path.md` (read API), `docs/design/write-path.md` (write API).

## Surfaces

| Surface | Access | Backed by |
|---|---|---|
| Beranda / Jelajah | public | `reading.browse` (title + creator search, genre filter, cursor paging) |
| Detail komik | public for `public`, by-link for `unlisted`, owner/admin for `private` and drafts | `reading.read({kind:"comic"})` |
| Reader | follows the comic's visibility | `reading.read({kind:"chapter"})` + `GET /pages/:id` |
| Perpustakaan | signed in | `reading.shelf` — saved comics **and** continue-reading in one page |
| Unggah | `creator` (own comics) and `admin` | `createComic`, `POST /publish/chapters` |
| Admin | `admin` | creator applications, reports, takedown, visibility |
| Masuk / Daftar | public | better-auth; signup grants `reader` |

Nav for v1: Jelajah · Cari · Perpustakaan (signed in) · Masuk/Daftar, plus Unggah and Admin by role. Continue-reading lives inside Perpustakaan rather than as its own item. Creator profiles are held back: the creator name already appears on the comic page.

## Catalogue

Grid of cover cards — 4 columns desktop, 2 on mobile — each showing cover, title, genre badges and chapter count. Cover is the click driver, so it gets the space. No list/grid toggle: two layouts to maintain for no proven benefit.

## Comic detail

Cover or first page as the visual anchor, then title, creator, genres, synopsis, chapter list, shelf toggle, rating summary, follow-creator control.

## Reader — continuous vertical scroll

Decided: one continuous vertical strip of pages, webtoon style. This is the decision with the most technical consequences:

1. **Page dimensions must be stored.** A continuous scroll without intrinsic aspect ratio reflows every time an image finishes loading, which jumps the reader's position mid-scroll. `Page` has no `width`/`height` today. Verified: `Bun.Image` in Bun 1.4.0 returns exact dimensions for PNG and JPEG with no dependency (tested: 120×180 and 90×140 read correctly), and also exposes `resize`/`webp` for later thumbnail work. So ingest reads dimensions once and stores them; the client reserves space with `aspect-ratio` before the bytes arrive.
2. **Lazy loading with a window.** Only pages near the viewport load; the rest are placeholder boxes of the correct height. Without this a 1000-page chapter is a memory event.
3. **Progress semantics.** The current page is the one covering the viewport's reading line (not the topmost partially-visible one). Writes are throttled and flushed on visibility change, so a chapter does not produce a request per scroll frame.
4. **Navigation.** Keyboard (page up/down, space) and click-to-advance jump a full page; chapter end offers the next chapter.
5. **Reader tokens only.** Near-black surfaces, chrome-light, accent `#DB6255` for progress and focus — the brand crimson is unusable there (2.33:1, measured).

## Upload (creator)

Comic creation form (title, synopsis, genres; visibility defaults to private, status to draft), then chapter upload: drag-and-drop for a single CBZ, or a multi-file image set, with upload progress.

Two requirements that follow from the transport finding in `write-path.md`:

- The client pre-checks total size before upload. Past the runtime ceiling (chapter cap + 8 MB) the server answers an **empty** 413 that no UI can explain; between the chapter cap and that ceiling the server answers a proper JSON `TOO_LARGE`.
- The UI maps `PublishingError` codes to messages verbatim, using `filename` where the module sets it.

## Admin

Creator applications (approve/reject), report queue, comic takedown and suspend, visibility override. Reactive moderation, as decided — no pre-publish queue.

## Social

Comments and 1–5 ratings at comic level, follow at creator level. Read progress is already implemented per `(user, chapter)`.

## Non-negotiables carried from the design work

- Contrast is measured per pairing, never inherited: `#A4A09E` is decoration on cream (2.39:1) and fine on the dark reader (7.28:1); `#9A2018` is AAA on cream and invisible on the reader (2.33:1).
- i18n from the start: Paraglide, `id` default with `en` fallback, locale in a cookie, no locale prefix in URLs.
- Public env values must be read as `ENV.KEY` from the generated module. Aliasing the import (`ENV as env`) defeats varlock's build-time replacement and throws in the browser — see commit `ec48275`.
- Page bytes are reachable only through `reading.read({kind:"page"})` / `GET /pages/:id`; no UI fetches a file path directly.

## Proposed handoff sequence

Scope answer was "everything" — upload, admin and comments included. That is three workstreams, and the last handoff that ran long stopped at its iteration budget with nothing committed, so it gets split rather than bundled:

| # | Scope | Why here |
|---|---|---|
| H1 | Schema additions (`Comment`, `Rating`, `Follow`, `Report`, `CreatorApplication`, plus `Page.width/height`), the social module with its own tests, admin endpoints, and dimension capture in ingest | Backend first: every UI surface then sits on a proven endpoint, and each piece keeps the module/ports/test pattern that already works here |
| H2 | UI read surfaces — Tailwind tokens, app shell, Jelajah, detail komik, reader (continuous scroll, dimensions, lazy window, progress) | The heaviest UI work, on a settled API |
| H3 | UI write surfaces — Unggah flow, Admin, comment/rating/follow controls | Multipart progress and error mapping deserve their own session |

Alternative if a visible screen is wanted sooner: fold H2 before H1 and stub the social controls. Costs one rewrite of the detail page when comments land — which is why H1 goes first.
