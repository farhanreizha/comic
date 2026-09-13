/**
 * Prisma-backed SocialDataPort. No access rules here — canView stays in
 * `@comic/reading`; the adapter only moves rows. Unique violations surface
 * as CONFLICT-coded errors the module translates.
 */

import type { Database } from "@comic/db";
import type {
	CommentAccessInfo,
	CommentRecord,
	NewCommentRow,
	NewReportRow,
	PageWindow,
	SocialDataPort,
	UserRecord,
} from "../types";

// P2002 = unique constraint (userId, comicId) / (followerId, creatorId) /
// the report's open-per-target index.
const isConflict = (error: unknown): boolean =>
	(error as { code?: string }).code === "P2002";

function conflict(): never {
	const error = new Error("unique constraint violation");
	(error as { code?: string }).code = "CONFLICT";
	throw error;
}

const commentSelect = {
	id: true,
	comicId: true,
	authorId: true,
	author: { select: { name: true } },
	body: true,
	hiddenAt: true,
	createdAt: true,
} as const;

type CommentRow = {
	id: string;
	comicId: string;
	authorId: string;
	author: { name: string };
	body: string;
	hiddenAt: Date | null;
	createdAt: Date;
};

const toCommentRecord = (row: CommentRow): CommentRecord => ({
	id: row.id,
	comicId: row.comicId,
	authorId: row.authorId,
	authorName: row.author.name,
	body: row.body,
	hiddenAt: row.hiddenAt,
	createdAt: row.createdAt,
});

/** Mechanical window filter: rows strictly after (createdAt, id), ASC. */
function windowWhere(window: PageWindow): Record<string, unknown> {
	if (!window.after) return {};
	return {
		OR: [
			{ createdAt: { gt: window.after.createdAt } },
			{
				createdAt: { equals: window.after.createdAt },
				id: { gt: window.after.id },
			},
		],
	};
}

export function createPrismaSocialData(db: Database): SocialDataPort {
	return {
		async findUserById(id) {
			const row = await db.user.findUnique({
				where: { id },
				select: { id: true, name: true, role: true },
			});
			return row ? (row as UserRecord) : null;
		},

		async insertComment(row: NewCommentRow) {
			const created = await db.comment.create({
				data: row,
				select: commentSelect,
			});
			return toCommentRecord(created);
		},
		async listComments(comicId, window, includeHidden) {
			const rows = await db.comment.findMany({
				where: {
					comicId,
					...(includeHidden ? {} : { hiddenAt: null }),
					...windowWhere(window),
				} as never,
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
				take: window.limit,
				select: commentSelect,
			});
			return rows.map(toCommentRecord);
		},
		async findComment(id) {
			const row = await db.comment.findUnique({
				where: { id },
				select: { id: true, comicId: true, authorId: true },
			});
			return row as CommentAccessInfo | null;
		},
		async deleteComment(id) {
			const deleted = await db.comment.deleteMany({ where: { id } });
			return deleted.count > 0;
		},
		async countComments(comicId, includeHidden) {
			return db.comment.count({
				where: {
					comicId,
					...(includeHidden ? {} : { hiddenAt: null }),
				} as never,
			});
		},

		async upsertRating(userId, comicId, value) {
			await db.rating.upsert({
				where: { userId_comicId: { userId, comicId } },
				create: { userId, comicId, value },
				update: { value },
			});
		},
		async ratingAggregate(comicId) {
			const agg = await db.rating.aggregate({
				where: { comicId },
				_count: { _all: true },
				_sum: { value: true },
			});
			return { count: agg._count._all, sum: agg._sum.value ?? 0 };
		},
		async userRating(userId, comicId) {
			const row = await db.rating.findUnique({
				where: { userId_comicId: { userId, comicId } },
				select: { value: true },
			});
			return row?.value ?? null;
		},

		async insertFollow(id, followerId, creatorId) {
			try {
				await db.follow.create({ data: { id, followerId, creatorId } });
			} catch (error) {
				if (isConflict(error)) conflict();
				throw error;
			}
		},
		async deleteFollow(followerId, creatorId) {
			await db.follow.deleteMany({ where: { followerId, creatorId } });
		},

		async insertReport(row: NewReportRow) {
			try {
				// status stays the schema default "open" so the unique index
				// (reporterId, targetType, targetId, status) guards one-open-per-target.
				await db.report.create({
					data: {
						id: row.id,
						targetType: row.targetType,
						targetId: row.targetId,
						reporterId: row.reporterId,
						reason: row.reason,
						note: row.note,
					},
				});
			} catch (error) {
				if (isConflict(error)) conflict();
				throw error;
			}
		},
	};
}
