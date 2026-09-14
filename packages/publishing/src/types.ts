/**
 * The `publishing` module's vocabulary — see docs/design/write-path.md.
 * Framework-free: no oRPC, Hono, Prisma, better-auth, or node:fs here.
 * Vocabulary (Viewer, Genre, Visibility, ComicCard, ChapterSummary) is
 * re-exported from `@comic/reading` so write and read paths cannot drift.
 */

import type {
	ChapterSummary,
	ComicCard,
	Genre,
	Viewer,
	Visibility,
} from "@comic/reading";

export type {
	ChapterSummary,
	ComicCard,
	Genre,
	Viewer,
	Visibility,
} from "@comic/reading";

export const MAX_CHAPTER_BYTES = 200 * 1024 * 1024; // 200 MB — one chapter
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB — one page image
export const MAX_PAGES_PER_CHAPTER = 1000;
export const MAX_ARCHIVE_ENTRIES = 2000;

/** One file the browser sent. contentType is ADVISORY — sniffed bytes decide. */
export type Upload = {
	filename: string;
	contentType: string;
	bytes: Uint8Array;
};

export type ComicDraft = {
	title: string; // the only required field
	slug?: string; // minted from title when absent
	synopsis?: string | null;
	genres?: readonly Genre[]; // default []
	visibility?: Visibility; // default private while draft
};

/** Metadata edit patch — absent keys stay as-is. Slug is NOT patchable:
 * reading URLs are the public contract; title edits keep the old slug.
 * visibility never touches status (decision #2: a draft stays a draft). */
export type ComicPatch = {
	title?: string;
	synopsis?: string | null;
	genres?: readonly Genre[];
	visibility?: Visibility;
};

export type ChapterSource =
	| { kind: "archive"; upload: Upload } // CBZ / ZIP
	| { kind: "images"; uploads: readonly Upload[] }; // loose page images

export type ChapterTarget =
	| { kind: "newChapter"; comicId: string; title?: string } // title default "Chapter {ordinal}"
	| { kind: "replaceChapter"; chapterId: string }; // re-upload after a bad scan

export type IngestInput = { source: ChapterSource; target: ChapterTarget };

export type PublishingErrorCode =
	| "UNAUTHENTICATED"
	| "FORBIDDEN"
	| "NOT_FOUND"
	| "INVALID_INPUT"
	| "TOO_LARGE"
	| "LIMIT_EXCEEDED"
	| "CONFLICT";

export type PublishingError = Error & {
	code: PublishingErrorCode;
	/** Set when the failure is attributable to one uploaded file. The UI renders this verbatim. */
	filename?: string;
};

export function publishingError(
	code: PublishingErrorCode,
	message: string,
	filename?: string,
): PublishingError {
	const error = new Error(message) as PublishingError;
	error.code = code;
	if (filename !== undefined) error.filename = filename;
	return error;
}

/* ---------- port record shapes (what adapters hand back) ---------- */

/**
 * Rows carry module-minted ids: storage keys embed the chapter id, so ids
 * must exist before any write (invariants 4/5). Prisma declares the same
 * @default(cuid()) columns; explicit values always win.
 */
export type NewComicRow = {
	id: string;
	slug: string;
	title: string;
	synopsis: string | null;
	ownerId: string;
	genres: Genre[];
	visibility: Visibility;
};

export type NewPageRow = {
	id: string;
	number: number;
	storageKey: string;
	contentType: string;
	/** Pixel dimensions, decoded at ingest (social-admin.md decision 8). */
	width: number;
	height: number;
};

export type NewChapterRow = {
	id: string;
	comicId: string;
	/** "" means the adapter defaults it to `Chapter {ordinal}` — the ordinal
	 * only exists inside the transaction that assigns it (invariant 9). */
	title: string;
	pages: NewPageRow[];
};

export type ComicRef = {
	id: string;
	slug: string;
	ownerId: string;
	coverUrl: string | null;
};

/** Normalised patch the adapters persist (absent keys stay as-is). */
export type ComicPatchData = {
	title?: string;
	synopsis?: string | null;
	genres?: Genre[];
	visibility?: Visibility;
};

export type PublishingDataPort = {
	findComic(id: string): Promise<ComicRef | null>;
	slugTaken(slug: string): Promise<boolean>;
	insertComic(row: NewComicRow): Promise<ComicCard>;
	/** Transactional: assigns ordinal, inserts chapter + pages, sets cover when it is the first chapter. */
	insertChapter(row: NewChapterRow): Promise<ChapterSummary>;
	/**
	 * Transactional: swaps the chapter's page rows. Returns the keys it
	 * replaced (the caller deletes them AFTER commit — invariant 5) and the
	 * fresh summary; the design doc's `{ replacedKeys }` plus the summary the
	 * entry point has to return.
	 */
	replaceChapterPages(
		chapterId: string,
		pages: NewPageRow[],
	): Promise<{ replacedKeys: string[]; chapter: ChapterSummary }>;
	findChapter(id: string): Promise<{ id: string; comicId: string } | null>;
	/** Transactional: applies the patch to the comic row, returns the fresh
	 * card (empty patch = current card unchanged). NOT_FOUND-coded error
	 * when the row vanished under us. */
	updateComic(id: string, patch: ComicPatchData): Promise<ComicCard>;
	/** Transactional: deletes the comic (DB cascade removes chapters/pages/
	 * comments/ratings/shelf rows) and returns every page storageKey that
	 * existed — the caller deletes those bytes AFTER commit (invariant 5). */
	deleteComic(id: string): Promise<{ storageKeys: string[] }>;
};

export type ChapterFilesPort = {
	put(
		key: string,
		file: { bytes: Uint8Array; contentType: string },
	): Promise<void>;
	delete(key: string): Promise<void>;
};

export type Publishing = {
	createComic(viewer: Viewer, draft: ComicDraft): Promise<ComicCard>;
	ingestChapter(viewer: Viewer, input: IngestInput): Promise<ChapterSummary>;
	/** Owner or admin only. Never changes status — visibility edits on a
	 * draft stay invisible to readers until a publish path exists. */
	updateComic(
		viewer: Viewer,
		comicId: string,
		patch: ComicPatch,
	): Promise<ComicCard>;
	/** Owner or admin only. Cascade: chapters + pages rows and their bytes. */
	deleteComic(viewer: Viewer, comicId: string): Promise<{ id: string }>;
};
