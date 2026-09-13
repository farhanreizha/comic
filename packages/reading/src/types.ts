/**
 * The `reading` module's vocabulary — see docs/design/reading-path.md.
 * Framework-free: no oRPC, Hono, Prisma, better-auth, or node:fs here.
 */

export type Role = "reader" | "creator" | "admin";
export type Visibility = "public" | "unlisted" | "private";
export type ComicStatus = "draft" | "published";

export type Genre =
	| "action"
	| "adventure"
	| "comedy"
	| "drama"
	| "fantasy"
	| "horror"
	| "mystery"
	| "romance"
	| "sci-fi"
	| "slice-of-life"
	| "sports"
	| "thriller";

/** Anonymous is a value, not an absence: callers always pass a Viewer. */
export type Viewer =
	| { readonly kind: "anonymous" }
	| { readonly kind: "user"; readonly id: string; readonly role: Role };

export const ANONYMOUS: Viewer = { kind: "anonymous" };

export type ComicCard = {
	id: string;
	slug: string;
	title: string;
	coverUrl: string | null;
	creator: { id: string; name: string };
	genres: Genre[];
	chapterCount: number;
	visibility: Visibility;
	status: ComicStatus;
	updatedAt: Date;
};

export type ChapterSummary = {
	id: string;
	comicId: string;
	ordinal: number;
	title: string;
	pageCount: number;
};

export type PageSummary = {
	id: string;
	number: number;
};

export type BrowseQuery = {
	q?: string;
	genre?: Genre;
	cursor?: string;
	limit?: number;
};
export type BrowseResult = { items: ComicCard[]; nextCursor: string | null };

export type ReadRef =
	| { kind: "comic"; ref: { id: string } | { slug: string } }
	| { kind: "chapter"; chapterId: string }
	| { kind: "page"; pageId: string };

export type ReadResult =
	| {
			kind: "comic";
			comic: ComicCard;
			synopsis: string | null;
			chapters: ChapterSummary[];
	  }
	| { kind: "chapter"; chapter: ChapterSummary; pages: PageSummary[] }
	| { kind: "page"; bytes: Uint8Array; contentType: string };

export type ContinueEntry = {
	comic: ComicCard;
	chapter: ChapterSummary;
	page: number;
	updatedAt: Date;
};

export type ReadingError = Error & {
	code: "NOT_FOUND" | "INVALID_INPUT" | "UNAUTHENTICATED";
};

export function readingError(
	code: ReadingError["code"],
	message: string,
): ReadingError {
	const error = new Error(message) as ReadingError;
	error.code = code;
	return error;
}

/* ---------- port record shapes (what adapters hand back) ---------- */

export type ComicRecord = {
	id: string;
	slug: string;
	title: string;
	synopsis: string | null;
	coverUrl: string | null;
	creatorId: string;
	creatorName: string;
	genres: Genre[];
	chapterCount: number;
	visibility: Visibility;
	status: ComicStatus;
	/** Non-null = taken down; canView denies everyone but admin. */
	takenDownAt: Date | null;
	updatedAt: Date;
};

export type ChapterRecord = {
	id: string;
	comicId: string;
	ordinal: number;
	title: string;
	pageCount: number;
};

export type PageRecord = {
	id: string;
	chapterId: string;
	number: number;
	storageKey: string;
	contentType: string;
};

export type ProgressRecord = {
	id: string;
	chapterId: string;
	page: number;
	updatedAt: Date;
};

/**
 * Computed by the module, translated mechanically by adapters. Visibility
 * rules live in this module, never in SQL.
 */
export type VisibilityScope =
	| { readonly kind: "publicPublished" }
	| { readonly kind: "publicPublishedOrOwned"; readonly userId: string }
	| { readonly kind: "all" };

export type ComicQuery = {
	q?: string;
	genre?: Genre;
	cursor?: string;
	limit: number;
};

export type ComicDataPort = {
	findComic(id: string): Promise<ComicRecord | null>;
	findComicBySlug(slug: string): Promise<ComicRecord | null>;
	listComics(query: ComicQuery, scope: VisibilityScope): Promise<ComicRecord[]>;
	listChapters(comicId: string): Promise<ChapterRecord[]>;
	findChapter(id: string): Promise<ChapterRecord | null>;
	listPages(chapterId: string): Promise<PageRecord[]>;
	findPage(id: string): Promise<PageRecord | null>;
	listSaved(userId: string): Promise<ComicRecord[]>;
	getProgress(
		userId: string,
		chapterId: string,
	): Promise<ProgressRecord | null>;
	listRecentProgress(userId: string, limit: number): Promise<ProgressRecord[]>;
	saveProgress(
		userId: string,
		chapterId: string,
		pageNumber: number,
	): Promise<void>;
};

export type PageFilesPort = {
	read(
		storageKey: string,
	): Promise<{ bytes: Uint8Array; contentType: string } | null>;
};

export type Reading = {
	browse(viewer: Viewer, query?: BrowseQuery): Promise<BrowseResult>;
	read(viewer: Viewer, ref: ReadRef): Promise<ReadResult>;
	shelf(
		viewer: Viewer,
	): Promise<{ saved: ComicCard[]; continueReading: ContinueEntry[] }>;
	recordProgress(
		viewer: Viewer,
		chapterId: string,
		page: number,
	): Promise<void>;
};
