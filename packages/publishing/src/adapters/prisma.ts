/**
 * Prisma-backed PublishingDataPort. insertChapter and replaceChapterPages
 * own their transactions — ordinal assignment happens inside (invariant 9),
 * and a unique violation surfaces as CONFLICT, never a raw driver error.
 */

import type { Database } from "@comic/db";
import type { ChapterSummary, ComicCard, Genre } from "@comic/reading";
import type {
	ComicRef,
	NewChapterRow,
	NewComicRow,
	NewPageRow,
	PublishingDataPort,
} from "../types";

// Same two-value mapping the reading adapter uses (db enum ↔ interface string).
const GENRE_TO_DB: Record<string, string> = {
	"sci-fi": "sci_fi",
	"slice-of-life": "slice_of_life",
};
const GENRE_FROM_DB: Record<string, Genre> = {
	sci_fi: "sci-fi",
	slice_of_life: "slice-of-life",
};

// P2002 = unique constraint (comicId, ordinal) / slug / storageKey collisions.
const isConflict = (error: unknown): boolean =>
	(error as { code?: string }).code === "P2002";

function conflict(): never {
	const error = new Error("unique constraint violation");
	(error as { code?: string }).code = "CONFLICT";
	throw error;
}

function toSummary(row: {
	id: string;
	comicId: string;
	ordinal: number;
	title: string;
	_count: { pages: number };
}): ChapterSummary {
	return {
		id: row.id,
		comicId: row.comicId,
		ordinal: row.ordinal,
		title: row.title,
		pageCount: row._count.pages,
	};
}

const chapterSelect = {
	id: true,
	comicId: true,
	ordinal: true,
	title: true,
	_count: { select: { pages: true } },
} as const;

export function createPrismaPublishingData(db: Database): PublishingDataPort {
	return {
		async findComic(id) {
			const row = await db.comic.findUnique({
				where: { id },
				select: { id: true, slug: true, ownerId: true, coverUrl: true },
			});
			return row as ComicRef | null;
		},
		async slugTaken(slug) {
			const found = await db.comic.findUnique({
				where: { slug },
				select: { id: true },
			});
			return found !== null;
		},
		async insertComic(row: NewComicRow): Promise<ComicCard> {
			try {
				const created = await db.comic.create({
					data: {
						id: row.id,
						slug: row.slug,
						title: row.title,
						synopsis: row.synopsis,
						ownerId: row.ownerId,
						// Invariant 12: safe defaults, regardless of input.
						visibility: row.visibility,
						status: "draft",
						genres: row.genres.map((g) => (GENRE_TO_DB[g] ?? g) as never),
					},
					include: {
						owner: { select: { id: true, name: true } },
						_count: { select: { chapters: true } },
					},
				});
				return {
					id: created.id,
					slug: created.slug,
					title: created.title,
					coverUrl: created.coverUrl,
					creator: { id: created.owner.id, name: created.owner.name },
					genres: created.genres.map((g) => (GENRE_FROM_DB[g] ?? g) as Genre),
					chapterCount: created._count.chapters,
					visibility: created.visibility as ComicCard["visibility"],
					status: created.status as ComicCard["status"],
					updatedAt: created.updatedAt,
				};
			} catch (error) {
				if (isConflict(error)) conflict();
				throw error;
			}
		},
		async insertChapter(row: NewChapterRow): Promise<ChapterSummary> {
			try {
				return await db.$transaction(async (tx) => {
					// Lock the comic row so two concurrent ingests cannot read the
					// same max(ordinal); the @@unique is the backstop, not the plan.
					await tx.$executeRaw`SELECT id FROM comic WHERE id = ${row.comicId} FOR UPDATE`;
					const agg = await tx.chapter.aggregate({
						where: { comicId: row.comicId },
						_max: { ordinal: true },
					});
					const ordinal = (agg._max.ordinal ?? 0) + 1;
					await tx.chapter.create({
						data: {
							id: row.id,
							comicId: row.comicId,
							ordinal,
							title: row.title || `Chapter ${ordinal}`,
							pages: { create: row.pages },
						},
					});
					// Invariant 10: cover follows the FIRST chapter, never overwritten.
					const firstPage = [...row.pages].sort(
						(a, b) => a.number - b.number,
					)[0];
					if (ordinal === 1 && firstPage) {
						await tx.comic.update({
							where: { id: row.comicId },
							data: { coverUrl: `/pages/${firstPage.id}` },
						});
					}
					const created = await tx.chapter.findUniqueOrThrow({
						where: { id: row.id },
						select: chapterSelect,
					});
					return toSummary(created);
				});
			} catch (error) {
				if (isConflict(error)) conflict();
				throw error;
			}
		},
		async replaceChapterPages(
			chapterId: string,
			pages: NewPageRow[],
		): Promise<{ replacedKeys: string[]; chapter: ChapterSummary }> {
			try {
				return await db.$transaction(async (tx) => {
					const old = await tx.page.findMany({
						where: { chapterId },
						select: { storageKey: true },
					});
					await tx.page.deleteMany({ where: { chapterId } });
					await tx.page.createMany({
						data: pages.map((p) => ({ ...p, chapterId })),
					});
					const chapter = await tx.chapter.findUniqueOrThrow({
						where: { id: chapterId },
						select: chapterSelect,
					});
					return {
						replacedKeys: old.map((p) => p.storageKey),
						chapter: toSummary(chapter),
					};
				});
			} catch (error) {
				if (isConflict(error)) conflict();
				throw error;
			}
		},
		async findChapter(id) {
			const row = await db.chapter.findUnique({
				where: { id },
				select: { id: true, comicId: true },
			});
			return row;
		},
	};
}
