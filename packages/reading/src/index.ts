import {
	browseVisible,
	canView,
	scopeFor,
	toCard,
	toPageSummary,
	toSummary,
} from "./access";
import type {
	BrowseQuery,
	BrowseResult,
	ComicCard,
	ComicDataPort,
	ComicRecord,
	ContinueEntry,
	PageFilesPort,
	Reading,
	ReadRef,
	ReadResult,
	Viewer,
} from "./types";
import { readingError } from "./types";

export { canView } from "./access";
export * from "./types";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const SHELF_CONTINUE_SCAN = 50;

/**
 * Cursor for `browse`: `${updatedAt.getTime()}\u0000${id}` — opaque to callers,
 * stable under the (updatedAt DESC, id DESC) ordering. Adapters filter with it
 * mechanically; the module decodes it.
 */
function encodeCursor(record: ComicRecord): string {
	return `${record.updatedAt.getTime()}\u0000${record.id}`;
}

function decodeCursor(cursor: string): { updatedAt: Date; id: string } | null {
	const [time, id] = cursor.split("\u0000");
	if (time === undefined || id === undefined) return null;
	const ms = Number(time);
	if (!Number.isFinite(ms)) return null;
	return { updatedAt: new Date(ms), id };
}

/** Resolve a comic and enforce invariant 1+3. Hidden looks missing. */
async function comicOrNotFound(
	data: ComicDataPort,
	viewer: Viewer,
	ref: { id: string } | { slug: string },
): Promise<ComicRecord> {
	const comic =
		"id" in ref
			? await data.findComic(ref.id)
			: await data.findComicBySlug(ref.slug);
	if (!comic || !canView(viewer, comic)) {
		throw readingError("NOT_FOUND", "comic not found");
	}
	return comic;
}

export function createReading(deps: {
	data: ComicDataPort;
	files: PageFilesPort;
}): Reading {
	const { data, files } = deps;

	async function resolveChapterComic(
		viewer: Viewer,
		chapterId: string,
	): Promise<{
		chapter: NonNullable<Awaited<ReturnType<ComicDataPort["findChapter"]>>>;
		comic: ComicRecord;
	}> {
		const chapter = await data.findChapter(chapterId);
		if (!chapter) throw readingError("NOT_FOUND", "chapter not found");
		const comic = await data.findComic(chapter.comicId);
		if (!comic || !canView(viewer, comic)) {
			throw readingError("NOT_FOUND", "chapter not found");
		}
		return { chapter, comic };
	}

	return {
		async browse(
			viewer: Viewer,
			query: BrowseQuery = {},
		): Promise<BrowseResult> {
			const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
			if (!Number.isInteger(limit) || limit < 1) {
				throw readingError("INVALID_INPUT", "limit must be a positive integer");
			}
			if (query.cursor !== undefined && !decodeCursor(query.cursor)) {
				throw readingError("INVALID_INPUT", "invalid cursor");
			}
			// Fetch limit+1 so the extra row decides nextCursor.
			const rows = await data.listComics(
				{
					q: query.q,
					genre: query.genre,
					cursor: query.cursor,
					limit: limit + 1,
				},
				scopeFor(viewer),
			);
			const allowed = rows.filter((row) => browseVisible(viewer, row));
			const items = allowed.slice(0, limit);
			const hasMore = allowed.length > limit;
			const last = items.at(-1);
			return {
				items: items.map(toCard),
				nextCursor: hasMore && last ? encodeCursor(last) : null,
			};
		},

		async read(viewer: Viewer, ref: ReadRef): Promise<ReadResult> {
			if (ref.kind === "comic") {
				const comic = await comicOrNotFound(data, viewer, ref.ref);
				const chapters = await data.listChapters(comic.id);
				return {
					kind: "comic",
					comic: toCard(comic),
					synopsis: comic.synopsis,
					chapters: chapters.map(toSummary),
				};
			}

			if (ref.kind === "chapter") {
				const { chapter } = await resolveChapterComic(viewer, ref.chapterId);
				const pages = await data.listPages(chapter.id);
				return {
					kind: "chapter",
					chapter: toSummary(chapter),
					pages: pages.map(toPageSummary),
				};
			}

			// kind === "page": bytes never leave this module any other way (invariant 1).
			const page = await data.findPage(ref.pageId);
			if (!page) throw readingError("NOT_FOUND", "page not found");
			await resolveChapterComic(viewer, page.chapterId);
			const stored = await files.read(page.storageKey);
			if (!stored) throw readingError("NOT_FOUND", "page not found");
			return {
				kind: "page",
				bytes: stored.bytes,
				contentType: stored.contentType,
			};
		},

		async shelf(
			viewer: Viewer,
		): Promise<{ saved: ComicCard[]; continueReading: ContinueEntry[] }> {
			if (viewer.kind === "anonymous") {
				throw readingError("UNAUTHENTICATED", "shelf requires a viewer");
			}
			const savedRecords = (await data.listSaved(viewer.id)).filter((comic) =>
				canView(viewer, comic),
			);

			const recent = await data.listRecentProgress(
				viewer.id,
				SHELF_CONTINUE_SCAN,
			);
			const continueReading: ContinueEntry[] = [];
			const seenComics = new Set<string>();
			for (const progress of recent) {
				const chapter = await data.findChapter(progress.chapterId);
				if (!chapter) continue;
				const comic = await data.findComic(chapter.comicId);
				// Invariant 6: unreadable since last read → drop, don't surface a broken entry.
				if (!comic || !canView(viewer, comic)) continue;
				if (seenComics.has(comic.id)) continue;
				seenComics.add(comic.id);
				continueReading.push({
					comic: toCard(comic),
					chapter: toSummary(chapter),
					page: progress.page,
					updatedAt: progress.updatedAt,
				});
			}

			return { saved: savedRecords.map(toCard), continueReading };
		},

		async recordProgress(
			viewer: Viewer,
			chapterId: string,
			page: number,
		): Promise<void> {
			if (viewer.kind === "anonymous") {
				throw readingError("UNAUTHENTICATED", "progress requires a viewer");
			}
			const { chapter } = await resolveChapterComic(viewer, chapterId);
			const pages = await data.listPages(chapter.id);
			const clamped = Math.max(1, Math.min(Math.trunc(page), pages.length));
			await data.saveProgress(viewer.id, chapter.id, clamped);
		},

		async saveComic(viewer: Viewer, comicId: string): Promise<void> {
			if (viewer.kind === "anonymous") {
				throw readingError("UNAUTHENTICATED", "saving requires a viewer");
			}
			// Idempotent by contract: the adapter upserts on (userId, comicId).
			const comic = await comicOrNotFound(data, viewer, { id: comicId });
			await data.saveComic(viewer.id, comic.id);
		},

		async unsaveComic(viewer: Viewer, comicId: string): Promise<void> {
			if (viewer.kind === "anonymous") {
				throw readingError("UNAUTHENTICATED", "unsaving requires a viewer");
			}
			const comic = await comicOrNotFound(data, viewer, { id: comicId });
			await data.unsaveComic(viewer.id, comic.id);
		},

		async isSaved(viewer: Viewer, comicId: string): Promise<boolean> {
			// A render-time read: never throws. Anonymous or hidden → false,
			// so it agrees with shelf()'s canView filtering by construction.
			if (viewer.kind === "anonymous") return false;
			const comic = await data.findComic(comicId);
			if (!comic || !canView(viewer, comic)) return false;
			return data.isSavedComic(viewer.id, comic.id);
		},
	};
}
