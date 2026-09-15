# Write path — chosen interface

Status: decided 2026-09-13. Companion to `docs/design/reading-path.md`. Source decisions: `/home/shota/hermes-vault/Inbox/2026-09-13-comic-project-decisions.md` (items 3, 4, 5, 19, 20).
Module: `packages/publishing` — framework-free, same shape as `packages/reading`: no oRPC, Hono, Prisma, better-auth, or `node:fs` at its interface. Vocabulary is imported from `@comic/reading` (`Viewer`, `Genre`, `Visibility`, `ComicStatus`) so the write and read paths cannot drift on what `private` or `sci-fi` means.

Four candidate interfaces were designed independently (minimal / flexible / caller-optimised / failure-first). This is the hybrid verdict; rejected parts are listed at the end.

## Interface — two entry points

```ts
export const MAX_CHAPTER_BYTES = 200 * 1024 * 1024; // 200 MB — one chapter
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;     // 5 MB — one page image
export const MAX_PAGES_PER_CHAPTER = 1000;
export const MAX_ARCHIVE_ENTRIES = 2000;

/** One file the browser sent. contentType is ADVISORY — sniffed bytes decide. */
export type Upload = { filename: string; contentType: string; bytes: Uint8Array };

export type ComicDraft = {
  title: string;                 // the only required field
  slug?: string;                 // minted from title when absent
  synopsis?: string | null;
  genres?: readonly Genre[];     // default []
  visibility?: Visibility;       // default private while draft
};

export type ChapterSource =
  | { kind: "archive"; upload: Upload }            // CBZ / ZIP
  | { kind: "images"; uploads: readonly Upload[] } // loose page images

export type ChapterTarget =
  | { kind: "newChapter"; comicId: string; title?: string } // title default "Chapter {ordinal}"
  | { kind: "replaceChapter"; chapterId: string };          // re-upload after a bad scan

export type IngestInput = { source: ChapterSource; target: ChapterTarget };

export type PublishingError = Error & {
  code:
    | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND"
    | "INVALID_INPUT" | "TOO_LARGE" | "LIMIT_EXCEEDED" | "CONFLICT";
  /** Set when the failure is attributable to one uploaded file. The UI renders this verbatim. */
  filename?: string;
};

export type Publishing = {
  createComic(viewer: Viewer, draft: ComicDraft): Promise<ComicCard>;
  ingestChapter(viewer: Viewer, input: IngestInput): Promise<ChapterSummary>;
};

export function createPublishing(deps: { data: PublishingDataPort; files: ChapterFilesPort }): Publishing;
```

## Invariants

1. **Authorisation, one place.** `createComic` requires `creator` or `admin`. `ingestChapter` requires the viewer to own the target comic, or be `admin`. Anonymous → `UNAUTHENTICATED`; authenticated but not permitted → `FORBIDDEN`. A comic that does not exist → `NOT_FOUND`.
2. **Bytes decide type.** `contentType` comes from sniffing magic bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF....WEBP`, AVIF `....ftypavif`, GIF). The browser-supplied `filename` and `contentType` are used for ordering and error messages only. An entry whose sniffed type is not an image is not a page.
3. **Ordering is natural, not lexical.** Archive entries and loose uploads sort by a natural-order comparison of filename, so `page2.png` precedes `page10.png`. Page `number` is 1-based and reflects that order.
4. **Zip-slip is structurally impossible.** Storage keys are minted by the module (`comics/<comicId>/chapters/<chapterId>/<number>.<ext>`); an archive entry's name is never used as a path. Entry names containing `..`, absolute paths, or backslashes are simply names, and the storage module's own key guard remains the second line.
5. **Files are written before rows are committed.** Every stored key is tracked during the operation. If any write fails, every key written so far is deleted and no `Chapter`/`Page` row is created. A `replaceChapter` ingest writes its new keys, commits the new rows, then deletes the keys it replaced — never the other order.
6. **Failure leaves readable state.** After any failure the caller can still `read` the comic: either the previous chapter state is intact, or the chapter does not exist. There is no state in which rows point at missing bytes.
7. **Crash-window orphans are accepted, deliberately.** If the process dies between the last `put` and the commit, unreferenced bytes remain on disk. The read path can never reach them (no row references them). Built: `list(prefix)` on `packages/storage` plus `bun run sweep:orphans` (apps/server), which deletes keys absent from `page.storageKey`/`creatorApplication.sampleKey` once they are older than a 15-minute grace window (protects in-flight ingests). Dry-run by default; `--apply` to reap; refuses production DATABASE_URLs like the seeder.
8. **Size limits are checked before writing.** `MAX_CHAPTER_BYTES` against the summed payload, `MAX_IMAGE_BYTES` per image, `MAX_PAGES_PER_CHAPTER` and `MAX_ARCHIVE_ENTRIES` against the extracted set. Violations are `TOO_LARGE` or `LIMIT_EXCEEDED` with `filename` set where a single file is at fault. Nothing is written when a limit fails up front.
9. **Ordinal assignment is transactional.** `ordinal = max(existing) + 1` inside the same transaction that inserts the chapter; `@@unique([comicId, ordinal])` is the backstop. A constraint violation surfaces as `CONFLICT` (retriable), never as a 500.
10. **Cover follows the first chapter.** When a comic's first chapter is committed, `comic.coverUrl` is set to that chapter's first page. A later chapter never overwrites it. This is decision Q2(a): cover = first page of chapter 1.
11. **Archive hygiene.** Non-image entries are ignored (`ComicInfo.xml`, `__MACOSX`, thumbs). An archive that yields zero images, or that fails to parse, is `INVALID_INPUT`.
12. **Comic defaults are safe.** A new comic starts `visibility: private`, `status: draft`. Publishing and visibility changes are a separate concern and out of this scope.

## Ports — two, each with two real adapters

```ts
export type PublishingDataPort = {
  findComic(id: string): Promise<{ id: string; slug: string; ownerId: string; coverUrl: string | null } | null>;
  slugTaken(slug: string): Promise<boolean>;
  insertComic(row: NewComicRow): Promise<ComicCard>;
  /** Transactional: assigns ordinal, inserts chapter + pages, sets cover when it is the first chapter. */
  insertChapter(row: NewChapterRow): Promise<ChapterSummary>;
  replaceChapterPages(chapterId: string, pages: NewPageRow[]): Promise<{ replacedKeys: string[] }>;
  findChapter(id: string): Promise<{ id: string; comicId: string } | null>;
};

export type ChapterFilesPort = {
  put(key: string, file: { bytes: Uint8Array; contentType: string }): Promise<void>;
  delete(key: string): Promise<void>;
};
```

- Prisma adapter + in-memory adapter for `PublishingDataPort`; the `storage` disk adapter + its memory adapter for `ChapterFilesPort`.
- **No archive port.** The archive reader is an internal seam: one dependency (`fflate`), one implementation. A decoder registry with one decoder is indirection, not a seam. It becomes a port the day a second real format (CBR) has a caller.
- **`storage` gains `list`.** `put`/`delete` served the write path; `list(prefix)` arrived with the orphan sweep (invariant 7), implemented in both the disk and memory adapters. An S3/R2 adapter adds it as a `ListObjectsV2` call with no interface change.

One dependency: `fflate` for ZIP. Verified 2026-09-13: `Bun.Archive` reads TAR only — feeding it a ZIP throws `Unrecognized archive format` — and there is no ZIP support in `Bun` 1.4.0 or Node 24 stdlib. The alternative is a hand-written central-directory parser (~150 lines of fiddly code across stored/deflate, data descriptors, CRC), which buys nothing over a zero-dependency 30 KB library.

## First tests (before the implementation, both ports in-memory)

1. Creator ingests a CBZ → pages 1..N in natural filename order, ordinal assigned, `comic.coverUrl` = first page of chapter 1.
2. Loose image set with the same names produces the same page order as the equivalent archive.
3. Reader, unrelated creator, and anonymous each fail with the right code; missing comic → `NOT_FOUND`.
4. Limits: chapter over 200 MB → `TOO_LARGE` before any write; one 6 MB image → `TOO_LARGE` naming it; 1001 pages → `LIMIT_EXCEEDED`.
5. Sniffing beats claims: bytes are JPEG but filename ends `.png` → page stored as `image/jpeg`.
6. Non-image entries ignored; archive of only `ComicInfo.xml` → `INVALID_INPUT`; truncated ZIP → `INVALID_INPUT`.
7. Malicious entry names (`../../etc/passwd`, `/abs/path.png`) never appear in a storage key.
8. Files port throws on the Nth `put` → zero `Page` rows, zero `Chapter`, and **every written key deleted** (assert the memory adapter is empty). This is the test that keeps invariant 6 honest.
9. Two concurrent ingests on one comic → distinct ordinals, both committed.
10. `replaceChapter` → new keys written, rows replaced, previous keys deleted; on failure the old chapter is intact and the old keys are untouched.

## Rejected, and why

- **A third entry point (`replaceChapter`) and a fourth (`arrangePages`)** — replace is folded into `ingestChapter`'s `target` union at no interface cost; reorder/append has no caller today.
- **`ArchiveDecoder` registry** — one implementation. Add it when CBR or PDF arrives.
- **An upload-claim table (`claimUpload` / `markUploadFailed` / `reapOrphans`)** — the failure-first design's answer to orphans is genuinely better at scale, and it is the right upgrade path. For one host with local disk it costs a table, a state machine, and a sweeper to clean up something no reader can reach. Invariant 7 records the ceiling instead of pretending it does not exist.
- **Streaming extraction** — storage is whole-buffer today and the largest object is 5 MB; the source archive is the only large object. When any single stored artifact can exceed memory, add `putStream(key, { body, contentType, contentLength })` to `StorageAdapter` and stream through it; nothing else in this interface moves.
- **`updateComic` / comic metadata edits** — separate write path with its own authorisation question; not needed for uploads to work.
