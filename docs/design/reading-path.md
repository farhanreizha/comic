# Reading path — chosen interface

Status: decided 2026-09-13. Source decisions: `/home/shota/hermes-vault/Inbox/2026-09-13-comic-project-decisions.md` (items 1–21).
Module: `packages/reading` — framework-free. It imports no oRPC, Hono, Prisma, better-auth, or `node:fs`; those arrive as values or adapters.

Four candidate interfaces were designed independently (minimal / flexible / caller-optimised / ports-and-adapters). This document is the hybrid verdict plus the reasoning; the rejected parts are listed at the end so nobody re-adds them without reading why.

## Vocabulary

```ts
export type Role = "reader" | "creator" | "admin";
export type Visibility = "public" | "unlisted" | "private";
export type ComicStatus = "draft" | "published";

export type Genre =
  | "action" | "adventure" | "comedy" | "drama" | "fantasy" | "horror"
  | "mystery" | "romance" | "sci-fi" | "slice-of-life" | "sports" | "thriller";

/** Anonymous is a value, not an absence: callers always pass a Viewer. */
export type Viewer = { readonly kind: "anonymous" } | { readonly kind: "user"; readonly id: string; readonly role: Role };
export const ANONYMOUS: Viewer = { kind: "anonymous" };
```

## Interface — four entry points

```ts
export type ComicCard = {
  id: string; slug: string; title: string;
  coverUrl: string | null;
  creator: { id: string; name: string };
  genres: Genre[];
  chapterCount: number;
  visibility: Visibility;   // present so callers can badge unlisted/private
  status: ComicStatus;
  updatedAt: Date;
};

export type BrowseQuery = { q?: string; genre?: Genre; cursor?: string; limit?: number };
export type BrowseResult = { items: ComicCard[]; nextCursor: string | null };

export type ReadRef =
  | { kind: "comic"; ref: { id: string } | { slug: string } }
  | { kind: "chapter"; chapterId: string }
  | { kind: "page"; pageId: string };

export type ReadResult =
  | { kind: "comic"; comic: ComicCard; synopsis: string | null; chapters: ChapterSummary[] }
  | { kind: "chapter"; chapter: ChapterSummary; pages: PageSummary[] }
  | { kind: "page"; bytes: Uint8Array; contentType: string };

export type ContinueEntry = { comic: ComicCard; chapter: ChapterSummary; page: number; updatedAt: Date };

export type Reading = {
  browse(viewer: Viewer, query?: BrowseQuery): Promise<BrowseResult>;
  read(viewer: Viewer, ref: ReadRef): Promise<ReadResult>;
  shelf(viewer: Viewer): Promise<{ saved: ComicCard[]; continueReading: ContinueEntry[] }>;
  recordProgress(viewer: Viewer, chapterId: string, page: number): Promise<void>;
};

export function createReading(deps: { data: ComicDataPort; files: PageFilesPort }): Reading;
```

## Invariants — every caller may rely on these

1. **One access decision.** `read` resolves `canView(viewer, comic)` internally before returning a comic, a chapter, or page bytes. Page bytes never leave the module any other way.
2. **Browse is scoped, not filtered.** `browse` returns comics where `canView` allows **and** (`visibility === "public"` **or** the viewer owns it **or** the viewer is admin). `unlisted` is reachable through `read` by anyone holding the id/slug, and never appears in `browse` for a non-owner.
3. **Hidden looks missing.** A comic that exists but is not viewable returns `NOT_FOUND` — identical to a comic that does not exist. No distinction leaks.
4. **Visibility × status.**

   | visibility | status | anonymous | reader | owner | admin |
   |---|---|---|---|---|---|
   | public | published | read | read | read | read |
   | public | draft | — | — | read | read |
   | unlisted | published | read (by id/slug) | read | read | read |
   | unlisted | draft | — | — | read | read |
   | private | published | — | — | read | read |
   | private | draft | — | — | read | read |

5. **Progress needs a viewer.** `recordProgress` with `ANONYMOUS` throws `UNAUTHENTICATED`. Recording progress on a comic the viewer cannot read throws `NOT_FOUND`. `page` is clamped to `[1, pageCount]`.
6. **Continue-reading is derived.** The most recent progress row for the viewer decides it; a comic that became unreadable since (taken down, made private) drops out rather than surfacing a broken entry.
7. **Ordering.** `browse` default order is `updatedAt DESC`, stable; chapters by `ordinal ASC`; pages by `number ASC`.
8. **Error type.** `ReadingError` with `code: "NOT_FOUND" | "INVALID_INPUT" | "UNAUTHENTICATED"`. Routers map codes to transport responses; the module stays transport-agnostic.

## Ports — two, both with two real adapters

```ts
export type ComicDataPort = {
  findComic(id: string): Promise<ComicRecord | null>;
  findComicBySlug(slug: string): Promise<ComicRecord | null>;
  listComics(query: ComicQuery, scope: VisibilityScope): Promise<ComicRecord[]>;
  listChapters(comicId: string): Promise<ChapterRecord[]>;
  findChapter(id: string): Promise<ChapterRecord | null>;
  listPages(chapterId: string): Promise<PageRecord[]>;
  findPage(id: string): Promise<PageRecord | null>;
  listSaved(userId: string): Promise<ComicRecord[]>;
  getProgress(userId: string, chapterId: string): Promise<ProgressRecord | null>;
  listRecentProgress(userId: string, limit: number): Promise<ProgressRecord[]>;
  saveProgress(userId: string, chapterId: string, pageNumber: number): Promise<void>;
};

export type PageFilesPort = {
  read(storageKey: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
};
```

- `ComicDataPort`: Prisma adapter in production, in-memory adapter in tests. `listComics` takes a `VisibilityScope` computed by the module, so visibility rules stay in one place instead of leaking into SQL.
- `PageFilesPort`: disk adapter in production (the `storage` module), in-memory adapter in tests.
- **No viewer port.** The viewer arrives as a plain value from the oRPC context / Hono middleware. A `resolve(Request)` port would have exactly one adapter — indirection, not a seam.
- Postgres and the clock are internal seams, not ports.

## First tests (write these before the implementation)

At the module's interface, with both in-memory adapters, no database and no filesystem:

1. **Parity**: for each viewer (anonymous, reader, owner, other creator, admin), `browse` items are exactly the comics the table in invariant 4 allows, and `read` on every one of them succeeds — and on every one not returned, fails with `NOT_FOUND`.
2. Private and draft comics: invisible to reader, visible to owner and admin, through `read`, through `shelf`, and through page bytes.
3. Page bytes for a private comic are unreachable by a non-owner, including by a known `pageId`.
4. Missing comic and hidden comic produce the same error.
5. Continue-reading drops a chapter whose comic became invisible.
6. `recordProgress` rejects `ANONYMOUS`, rejects unreachable comics, clamps out-of-range pages.

Test 1 is the one that keeps the project's first rule honest. If it is red, access is leaking.

## Rejected, and why

- **`browse(query)` without a viewer** — bakes "browse is public only" into the interface, so a creator cannot see their own drafts and an admin cannot browse the queue. `ANONYMOUS` as an explicit value gives the same ergonomics without lying.
- **`Facet[]`, `ListScope`, three orderings, composable `AccessRule` chains** — interface size bought against hypothetical futures (RSS, export, recommendations) that no caller needs in v1. Add when a real caller arrives.
- **`ViewerPort` / `resolve(Request)`** — one adapter, and it drags HTTP into a framework-free module.
- **A `Reader` object with a bound viewer (`withViewer`)** — a per-request object with no behaviour of its own; passing the viewer keeps four entry points in one place.
- **Separate `readPage` entry point** — folded into `read`'s union so page bytes cannot be fetched through a path that skips the other reads' guarantees.
