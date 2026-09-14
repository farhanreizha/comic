import type {
	ChapterRecord,
	ComicDataPort,
	ComicQuery,
	ComicRecord,
	PageRecord,
	ProgressRecord,
	VisibilityScope,
} from "../types";

export type MemorySeed = {
	comics?: ComicRecord[];
	chapters?: ChapterRecord[];
	pages?: PageRecord[];
	progress?: (ProgressRecord & { userId: string })[];
	saved?: { userId: string; comicId: string }[];
};

const cmp = (comic: ComicRecord): [number, string] => [
	-comic.updatedAt.getTime(),
	comic.id,
];
const byUpdatedDesc = (a: ComicRecord, b: ComicRecord): number => {
	const [ta, ia] = cmp(a);
	const [tb, ib] = cmp(b);
	return ta !== tb ? ta - tb : ib.localeCompare(ia);
};

/** In-memory ComicDataPort for tests. Same ordering contract as Prisma: updatedAt DESC, id DESC. */
export function createMemoryComicData(seed: MemorySeed = {}): ComicDataPort & {
	seed: {
		comics: ComicRecord[];
		chapters: ChapterRecord[];
		pages: PageRecord[];
		progress: (ProgressRecord & { userId: string })[];
		saved: { userId: string; comicId: string }[];
	};
} {
	const comics = [...(seed.comics ?? [])];
	const chapters = [...(seed.chapters ?? [])];
	const pages = [...(seed.pages ?? [])];
	const progress = [...(seed.progress ?? [])];
	const saved = [...(seed.saved ?? [])];

	const chapterPageCount = (chapterId: string): number =>
		pages.filter((p) => p.chapterId === chapterId).length;

	return {
		seed: { comics, chapters, pages, progress, saved },

		async findComic(id) {
			return comics.find((c) => c.id === id) ?? null;
		},
		async findComicBySlug(slug) {
			return comics.find((c) => c.slug === slug) ?? null;
		},
		async listComics(query: ComicQuery, scope: VisibilityScope) {
			let rows = comics.filter((c) => {
				if (scope.kind === "publicPublished") {
					return c.visibility === "public" && c.status === "published";
				}
				if (scope.kind === "publicPublishedOrOwned") {
					return (
						(c.visibility === "public" && c.status === "published") ||
						c.creatorId === scope.userId
					);
				}
				return true;
			});
			if (query.q) {
				const needle = query.q.toLowerCase();
				rows = rows.filter(
					(c) =>
						c.title.toLowerCase().includes(needle) ||
						c.creatorName.toLowerCase().includes(needle),
				);
			}
			if (query.genre)
				rows = rows.filter((c) => c.genres.includes(query.genre as never));
			if (query.cursor) {
				const [time, id] = query.cursor.split("\u0000");
				const ms = Number(time);
				if (Number.isFinite(ms) && id) {
					rows = rows.filter(
						(c) =>
							c.updatedAt.getTime() < ms ||
							(c.updatedAt.getTime() === ms && c.id < id),
					);
				}
			}
			rows = [...rows].sort(byUpdatedDesc);
			return rows.slice(0, query.limit);
		},
		async listChapters(comicId) {
			return chapters
				.filter((c) => c.comicId === comicId)
				.sort((a, b) => a.ordinal - b.ordinal)
				.map((c) => ({ ...c, pageCount: chapterPageCount(c.id) }));
		},
		async findChapter(id) {
			const found = chapters.find((c) => c.id === id);
			return found ? { ...found, pageCount: chapterPageCount(found.id) } : null;
		},
		async listPages(chapterId) {
			return pages
				.filter((p) => p.chapterId === chapterId)
				.sort((a, b) => a.number - b.number);
		},
		async findPage(id) {
			return pages.find((p) => p.id === id) ?? null;
		},
		async listSaved(userId) {
			const ids = new Set(
				saved.filter((s) => s.userId === userId).map((s) => s.comicId),
			);
			return comics.filter((c) => ids.has(c.id)).sort(byUpdatedDesc);
		},
		async saveComic(userId, comicId) {
			const exists = saved.some(
				(s) => s.userId === userId && s.comicId === comicId,
			);
			if (!exists) saved.push({ userId, comicId });
		},
		async unsaveComic(userId, comicId) {
			const i = saved.findIndex(
				(s) => s.userId === userId && s.comicId === comicId,
			);
			if (i !== -1) saved.splice(i, 1);
		},
		async isSavedComic(userId, comicId) {
			return saved.some((s) => s.userId === userId && s.comicId === comicId);
		},
		async getProgress(userId, chapterId) {
			const found = progress.find(
				(p) => p.userId === userId && p.chapterId === chapterId,
			);
			if (!found) return null;
			const { userId: _drop, ...record } = found;
			return record;
		},
		async listRecentProgress(userId, limit) {
			return progress
				.filter((p) => p.userId === userId)
				.sort(
					(a, b) =>
						b.updatedAt.getTime() - a.updatedAt.getTime() ||
						b.id.localeCompare(a.id),
				)
				.slice(0, limit)
				.map(({ userId: _drop, ...record }) => record);
		},
		async saveProgress(userId, chapterId, pageNumber) {
			const existing = progress.find(
				(p) => p.userId === userId && p.chapterId === chapterId,
			);
			if (existing) {
				existing.page = pageNumber;
				existing.updatedAt = new Date();
				return;
			}
			progress.push({
				id: `prog-${progress.length + 1}`,
				userId,
				chapterId,
				page: pageNumber,
				updatedAt: new Date(),
			});
		},
	};
}
