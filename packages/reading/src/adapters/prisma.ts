import type { Database } from "@comic/db";
import type {
	ChapterRecord,
	ComicDataPort,
	ComicQuery,
	ComicRecord,
	Genre,
	PageRecord,
	ProgressRecord,
	VisibilityScope,
} from "../types";

const comicSelect = {
	id: true,
	slug: true,
	title: true,
	synopsis: true,
	coverUrl: true,
	genres: true,
	visibility: true,
	status: true,
	takenDownAt: true,
	updatedAt: true,
	owner: { select: { id: true, name: true } },
	_count: { select: { chapters: true } },
} as const;

type ComicRow = {
	id: string;
	slug: string;
	title: string;
	synopsis: string | null;
	coverUrl: string | null;
	genres: string[];
	visibility: string;
	status: string;
	takenDownAt: Date | null;
	updatedAt: Date;
	owner: { id: string; name: string };
	_count: { chapters: number };
};

// Prisma enum names differ from the interface's genre strings for two values.
const GENRE_FROM_DB: Record<string, Genre> = {
	sci_fi: "sci-fi",
	slice_of_life: "slice-of-life",
};
const GENRE_TO_DB: Record<string, string> = {
	"sci-fi": "sci_fi",
	"slice-of-life": "slice_of_life",
};

function toComicRecord(row: ComicRow): ComicRecord {
	return {
		id: row.id,
		slug: row.slug,
		title: row.title,
		synopsis: row.synopsis,
		coverUrl: row.coverUrl,
		creatorId: row.owner.id,
		creatorName: row.owner.name,
		genres: row.genres.map((g) => (GENRE_FROM_DB[g] ?? g) as Genre),
		chapterCount: row._count.chapters,
		visibility: row.visibility as ComicRecord["visibility"],
		status: row.status as ComicRecord["status"],
		takenDownAt: row.takenDownAt,
		updatedAt: row.updatedAt,
	};
}

function scopeWhere(scope: VisibilityScope): Record<string, unknown> {
	if (scope.kind === "publicPublished") {
		return { visibility: "public", status: "published" };
	}
	if (scope.kind === "publicPublishedOrOwned") {
		return {
			OR: [
				{ visibility: "public", status: "published" },
				{ ownerId: scope.userId },
			],
		};
	}
	return {};
}

const pageSelect = {
	id: true,
	chapterId: true,
	number: true,
	storageKey: true,
	contentType: true,
	width: true,
	height: true,
} as const;

const chapterSelect = {
	id: true,
	comicId: true,
	ordinal: true,
	title: true,
	_count: { select: { pages: true } },
} as const;

type ChapterRow = {
	id: string;
	comicId: string;
	ordinal: number;
	title: string;
	_count: { pages: number };
};

function toChapterRecord(row: ChapterRow): ChapterRecord {
	return {
		id: row.id,
		comicId: row.comicId,
		ordinal: row.ordinal,
		title: row.title,
		pageCount: row._count.pages,
	};
}

const progressSelect = {
	id: true,
	chapterId: true,
	page: true,
	updatedAt: true,
} as const;

/** Prisma-backed ComicDataPort. No access rules here — the scope arrives computed by the module. */
export function createPrismaComicData(db: Database): ComicDataPort {
	return {
		async findComic(id) {
			const row = await db.comic.findUnique({
				where: { id },
				select: comicSelect,
			});
			return row ? toComicRecord(row) : null;
		},
		async findComicBySlug(slug) {
			const row = await db.comic.findUnique({
				where: { slug },
				select: comicSelect,
			});
			return row ? toComicRecord(row) : null;
		},
		async listComics(query: ComicQuery, scope: VisibilityScope) {
			const and: Record<string, unknown>[] = [scopeWhere(scope)];
			if (query.q) {
				and.push({
					OR: [
						{ title: { contains: query.q, mode: "insensitive" } },
						{ owner: { name: { contains: query.q, mode: "insensitive" } } },
					],
				});
			}
			if (query.genre) {
				and.push({
					genres: { has: (GENRE_TO_DB[query.genre] ?? query.genre) as never },
				});
			}
			if (query.cursor) {
				const [time, id] = query.cursor.split("\u0000");
				const ms = Number(time);
				if (Number.isFinite(ms) && id) {
					and.push({
						OR: [
							{ updatedAt: { lt: new Date(ms) } },
							{ updatedAt: { equals: new Date(ms) }, id: { lt: id } },
						],
					});
				}
			}
			const rows = await db.comic.findMany({
				where: { AND: and } as never,
				select: comicSelect,
				orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
				take: query.limit,
			});
			return rows.map(toComicRecord);
		},
		async listChapters(comicId) {
			const rows = await db.chapter.findMany({
				where: { comicId },
				orderBy: { ordinal: "asc" },
				select: chapterSelect,
			});
			return rows.map(toChapterRecord);
		},
		async findChapter(id) {
			const row = await db.chapter.findUnique({
				where: { id },
				select: chapterSelect,
			});
			return row ? toChapterRecord(row) : null;
		},
		async listPages(chapterId) {
			return db.page.findMany({
				where: { chapterId },
				orderBy: { number: "asc" },
				select: pageSelect,
			}) as Promise<PageRecord[]>;
		},
		async findPage(id) {
			return db.page.findUnique({
				where: { id },
				select: pageSelect,
			}) as Promise<PageRecord | null>;
		},
		async listSaved(userId) {
			const rows = await db.savedComic.findMany({
				where: { userId },
				orderBy: { createdAt: "desc" },
				select: { comic: { select: comicSelect } },
			});
			return rows.map((row) => toComicRecord(row.comic));
		},
		async saveComic(userId, comicId) {
			// Idempotent: upsert on the (userId, comicId) unique — no CONFLICT.
			await db.savedComic.upsert({
				where: { userId_comicId: { userId, comicId } },
				create: { userId, comicId },
				update: {},
			});
		},
		async unsaveComic(userId, comicId) {
			await db.savedComic.deleteMany({ where: { userId, comicId } });
		},
		async isSavedComic(userId, comicId) {
			const row = await db.savedComic.findUnique({
				where: { userId_comicId: { userId, comicId } },
				select: { id: true },
			});
			return row !== null;
		},
		async getProgress(userId, chapterId) {
			return db.progress.findUnique({
				where: { userId_chapterId: { userId, chapterId } },
				select: progressSelect,
			}) as Promise<ProgressRecord | null>;
		},
		async listRecentProgress(userId, limit) {
			return db.progress.findMany({
				where: { userId },
				orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
				take: limit,
				select: progressSelect,
			}) as Promise<ProgressRecord[]>;
		},
		async saveProgress(userId, chapterId, pageNumber) {
			await db.progress.upsert({
				where: { userId_chapterId: { userId, chapterId } },
				create: { userId, chapterId, page: pageNumber },
				update: { page: pageNumber },
			});
		},
	};
}
