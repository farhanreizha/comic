/**
 * In-memory PublishingDataPort for tests. Mirrors the Prisma adapter's
 * contract exactly: ordinal assignment and cover-setting happen "inside"
 * insertChapter, replaceChapterPages swaps rows atomically.
 */

import type { ChapterSummary, ComicCard, Genre } from "@comic/reading";
import type {
	ComicRef,
	NewComicRow,
	NewPageRow,
	PublishingDataPort,
} from "../types";

type ComicRow = NewComicRow & { coverUrl: string | null; chapterCount: number };

function toCard(c: ComicRow): ComicCard {
	return {
		id: c.id,
		slug: c.slug,
		title: c.title,
		coverUrl: c.coverUrl,
		creator: { id: c.ownerId, name: c.ownerId },
		genres: [...(c.genres as Genre[])],
		chapterCount: c.chapterCount,
		visibility: c.visibility,
		status: "draft",
		updatedAt: new Date(),
	};
}

export function createMemoryPublishingData(
	seed: { comics?: NewComicRow[] } = {},
): PublishingDataPort & {
	comics: ComicRow[];
	chapterPages: Map<string, NewPageRow[]>;
} {
	const comics: ComicRow[] = (seed.comics ?? []).map((c) => ({
		...c,
		coverUrl: null,
		chapterCount: 0,
	}));
	const chapters = new Map<
		string,
		{ comicId: string; ordinal: number; title: string }
	>();
	const chapterPages = new Map<string, NewPageRow[]>();

	const summary = (id: string): ChapterSummary => {
		const ch = chapters.get(id);
		if (!ch) throw new Error(`missing chapter ${id}`);
		return {
			id,
			comicId: ch.comicId,
			ordinal: ch.ordinal,
			title: ch.title,
			pageCount: chapterPages.get(id)?.length ?? 0,
		};
	};

	return {
		comics,
		chapterPages,

		async findComic(id) {
			const c = comics.find((x) => x.id === id);
			if (!c) return null;
			const ref: ComicRef = {
				id: c.id,
				slug: c.slug,
				ownerId: c.ownerId,
				coverUrl: c.coverUrl,
			};
			return ref;
		},
		async slugTaken(slug) {
			return comics.some((c) => c.slug === slug);
		},
		async insertComic(row) {
			if (comics.some((c) => c.slug === row.slug)) {
				const err = new Error("slug unique violation");
				(err as { code?: string }).code = "CONFLICT";
				throw err;
			}
			const stored: ComicRow = { ...row, coverUrl: null, chapterCount: 0 };
			comics.push(stored);
			return toCard(stored);
		},
		async insertChapter(row) {
			const comic = comics.find((c) => c.id === row.comicId);
			if (!comic) {
				const err = new Error(`comic ${row.comicId} not found`);
				(err as { code?: string }).code = "NOT_FOUND";
				throw err;
			}
			let maxOrdinal = 0;
			for (const ch of chapters.values()) {
				if (ch.comicId === row.comicId)
					maxOrdinal = Math.max(maxOrdinal, ch.ordinal);
			}
			const ordinal = maxOrdinal + 1;
			if (chapters.has(row.id)) {
				const err = new Error("chapter id unique violation");
				(err as { code?: string }).code = "CONFLICT";
				throw err;
			}
			chapters.set(row.id, {
				comicId: row.comicId,
				ordinal,
				title: row.title || `Chapter ${ordinal}`,
			});
			chapterPages.set(
				row.id,
				row.pages.map((p) => ({ ...p })),
			);
			comic.chapterCount += 1;
			// Invariant 10: the FIRST chapter's first page becomes the cover,
			// stored as the public image path the read path serves.
			if (ordinal === 1 && comic.coverUrl === null) {
				const first = row.pages.reduce<NewPageRow | null>(
					(min, p) => (min === null || p.number < min.number ? p : min),
					null,
				);
				if (first) comic.coverUrl = `/pages/${first.id}`;
			}
			return summary(row.id);
		},
		async replaceChapterPages(chapterId, pages) {
			const ch = chapters.get(chapterId);
			if (!ch) {
				const err = new Error(`chapter ${chapterId} not found`);
				(err as { code?: string }).code = "NOT_FOUND";
				throw err;
			}
			const old = chapterPages.get(chapterId) ?? [];
			const replacedKeys = old.map((p) => p.storageKey);
			chapterPages.set(
				chapterId,
				pages.map((p) => ({ ...p })),
			);
			const out = summary(chapterId);
			return { replacedKeys, chapter: out };
		},
		async findChapter(id) {
			const ch = chapters.get(id);
			return ch ? { id, comicId: ch.comicId } : null;
		},
		async updateComic(id, patch) {
			const c = comics.find((x) => x.id === id);
			if (!c) {
				const err = new Error(`comic ${id} not found`);
				(err as { code?: string }).code = "NOT_FOUND";
				throw err;
			}
			if (patch.title !== undefined) c.title = patch.title;
			if (patch.synopsis !== undefined) c.synopsis = patch.synopsis;
			if (patch.genres !== undefined) c.genres = [...patch.genres];
			if (patch.visibility !== undefined) c.visibility = patch.visibility;
			return toCard(c);
		},
		async deleteComic(id) {
			const idx = comics.findIndex((x) => x.id === id);
			if (idx === -1) {
				const err = new Error(`comic ${id} not found`);
				(err as { code?: string }).code = "NOT_FOUND";
				throw err;
			}
			const storageKeys: string[] = [];
			for (const [chapterId, ch] of chapters) {
				if (ch.comicId !== id) continue;
				for (const p of chapterPages.get(chapterId) ?? []) {
					storageKeys.push(p.storageKey);
				}
				chapters.delete(chapterId);
				chapterPages.delete(chapterId);
			}
			comics.splice(idx, 1);
			return { storageKeys };
		},
	};
}
