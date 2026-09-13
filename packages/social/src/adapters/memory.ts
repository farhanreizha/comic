/**
 * In-memory SocialDataPort for tests. Mirrors the Prisma adapter's contract:
 * unique follow + open-report pairs throw CONFLICT-coded errors, comment
 * windows filter hidden rows unless includeHidden.
 */

import type {
	CommentAccessInfo,
	CommentRecord,
	NewCommentRow,
	NewReportRow,
	PageWindow,
	SocialDataPort,
	UserRecord,
} from "../types";

type ReportRow = NewReportRow & {
	status: "open" | "resolved" | "dismissed";
	createdAt: Date;
};

export type MemorySocialSeed = {
	users?: UserRecord[];
	comics?: { id: string }[];
	comments?: CommentRecord[];
};

const conflict = (what: string): never => {
	const error = new Error(what);
	(error as { code?: string }).code = "CONFLICT";
	throw error;
};

export function createMemorySocialData(
	seed: MemorySocialSeed = {},
): SocialDataPort & {
	comments: CommentRecord[];
	ratings: Map<string, { userId: string; comicId: string; value: number }>;
	follows: { followerId: string; creatorId: string }[];
	reports: ReportRow[];
	users: UserRecord[];
} {
	const users = [...(seed.users ?? [])];
	const comments = [...(seed.comments ?? [])];
	const ratings = new Map<
		string,
		{ userId: string; comicId: string; value: number }
	>();
	const follows: { followerId: string; creatorId: string }[] = [];
	const reports: ReportRow[] = [];

	const ratingKey = (userId: string, comicId: string) =>
		`${userId}\u0000${comicId}`;

	const authorName = (id: string) => users.find((u) => u.id === id)?.name ?? id;

	return {
		comments,
		ratings,
		follows,
		reports,
		users,

		async findUserById(id) {
			return users.find((u) => u.id === id) ?? null;
		},

		async insertComment(row: NewCommentRow): Promise<CommentRecord> {
			const created: CommentRecord = {
				id: row.id,
				comicId: row.comicId,
				authorId: row.authorId,
				authorName: authorName(row.authorId),
				body: row.body,
				hiddenAt: null,
				createdAt: new Date(),
			};
			comments.push(created);
			return created;
		},
		async listComments(comicId, window: PageWindow, includeHidden) {
			let rows = comments
				.filter((c) => c.comicId === comicId)
				.filter((c) => includeHidden || c.hiddenAt === null)
				.sort(
					(a, b) =>
						a.createdAt.getTime() - b.createdAt.getTime() ||
						a.id.localeCompare(b.id),
				);
			if (window.after) {
				const { createdAt, id } = window.after;
				rows = rows.filter(
					(c) =>
						c.createdAt.getTime() > createdAt.getTime() ||
						(c.createdAt.getTime() === createdAt.getTime() && c.id > id),
				);
			}
			return rows.slice(0, window.limit);
		},
		async findComment(id): Promise<CommentAccessInfo | null> {
			const c = comments.find((x) => x.id === id);
			return c ? { id: c.id, comicId: c.comicId, authorId: c.authorId } : null;
		},
		async deleteComment(id) {
			const i = comments.findIndex((c) => c.id === id);
			if (i === -1) return false;
			comments.splice(i, 1);
			return true;
		},
		async countComments(comicId, includeHidden) {
			return comments.filter(
				(c) => c.comicId === comicId && (includeHidden || c.hiddenAt === null),
			).length;
		},

		async upsertRating(userId, comicId, value) {
			ratings.set(ratingKey(userId, comicId), { userId, comicId, value });
		},
		async ratingAggregate(comicId) {
			let count = 0;
			let sum = 0;
			for (const r of ratings.values()) {
				if (r.comicId === comicId) {
					count += 1;
					sum += r.value;
				}
			}
			return { count, sum };
		},
		async userRating(userId, comicId) {
			return ratings.get(ratingKey(userId, comicId))?.value ?? null;
		},

		async insertFollow(_id, followerId, creatorId) {
			if (
				follows.some(
					(f) => f.followerId === followerId && f.creatorId === creatorId,
				)
			) {
				conflict("follow unique violation");
			}
			follows.push({ followerId, creatorId });
		},
		async deleteFollow(followerId, creatorId) {
			const i = follows.findIndex(
				(f) => f.followerId === followerId && f.creatorId === creatorId,
			);
			if (i !== -1) follows.splice(i, 1);
		},

		async insertReport(row: NewReportRow) {
			const open = reports.some(
				(r) =>
					r.status === "open" &&
					r.reporterId === row.reporterId &&
					r.targetType === row.targetType &&
					r.targetId === row.targetId,
			);
			if (open) conflict("report unique violation");
			reports.push({ ...row, status: "open", createdAt: new Date() });
		},
	};
}
