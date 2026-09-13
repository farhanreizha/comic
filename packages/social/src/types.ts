/**
 * The `social` module's vocabulary — see docs/design/social-admin.md.
 * Framework-free: no oRPC, Hono, Prisma, better-auth, or node:fs here.
 * Viewer/Role/ComicRecord/canView are re-used from `@comic/reading` so the
 * access decision has exactly one home (invariant 3).
 */

import type { ComicRecord, Role, Viewer } from "@comic/reading";

export type { ComicRecord, Role, Viewer };

/** Invariant 14: the same five codes as PublishingError's vocabulary. */
export type SocialErrorCode =
	| "UNAUTHENTICATED"
	| "FORBIDDEN"
	| "NOT_FOUND"
	| "INVALID_INPUT"
	| "CONFLICT";

export type SocialError = Error & { code: SocialErrorCode };

export function socialError(
	code: SocialErrorCode,
	message: string,
): SocialError {
	const error = new Error(message) as SocialError;
	error.code = code;
	return error;
}

export const MAX_COMMENT_BODY = 2000;
export const MAX_REPORT_NOTE = 1000;

export type ReportTargetType = "comic" | "comment";
export type ReportReason =
	| "sexual_content"
	| "copyright"
	| "harassment"
	| "spam"
	| "other";

export const REPORT_REASONS: readonly ReportReason[] = [
	"sexual_content",
	"copyright",
	"harassment",
	"spam",
	"other",
];

/* ---------- views (what the entry points hand back) ---------- */

export type CommentView = {
	id: string;
	comicId: string;
	author: { id: string; name: string };
	body: string;
	/** Non-null = hidden by moderation; present in the view so admin UIs can render it. */
	hiddenAt: Date | null;
	createdAt: Date;
};

export type CommentList = {
	items: CommentView[];
	nextCursor: string | null;
	/**
	 * Total comments visible to THIS viewer (hidden excluded unless admin) —
	 * invariant 5's count, computed on read, no counter column.
	 */
	count: number;
};

/** Invariant 4: average + count, computed on read; `userValue` is the viewer's own. */
export type RatingSummary = {
	average: number | null;
	count: number;
	userValue: number | null;
};

/* ---------- port record shapes (what adapters hand back) ---------- */

export type CommentRecord = {
	id: string;
	comicId: string;
	authorId: string;
	authorName: string;
	body: string;
	hiddenAt: Date | null;
	createdAt: Date;
};

export type UserRecord = {
	id: string;
	name: string;
	role: Role;
};

export type NewCommentRow = {
	id: string;
	comicId: string;
	authorId: string;
	body: string;
};

export type NewReportRow = {
	id: string;
	targetType: ReportTargetType;
	targetId: string;
	reporterId: string;
	reason: ReportReason;
	note: string | null;
};

/** "after" is decoded by the module: rows strictly after (createdAt, id). */
export type PageWindow = {
	after: { createdAt: Date; id: string } | null;
	limit: number;
};

/**
 * Comic lookups for the access check. In production this is structurally
 * satisfied by `reading`'s Prisma adapter — social never re-implements the
 * query and never re-implements canView (invariants 2/3).
 */
export type ComicAccessPort = {
	findComic(id: string): Promise<import("@comic/reading").ComicRecord | null>;
};

/** What an id-addressable comment must expose for ownership + report checks. */
export type CommentAccessInfo = {
	id: string;
	comicId: string;
	authorId: string;
};

export type SocialDataPort = {
	findUserById(id: string): Promise<UserRecord | null>;

	insertComment(row: NewCommentRow): Promise<CommentRecord>;
	listComments(
		comicId: string,
		window: PageWindow,
		includeHidden: boolean,
	): Promise<CommentRecord[]>;
	findComment(id: string): Promise<CommentAccessInfo | null>;
	deleteComment(id: string): Promise<boolean>;
	countComments(comicId: string, includeHidden: boolean): Promise<number>;

	upsertRating(userId: string, comicId: string, value: number): Promise<void>;
	ratingAggregate(comicId: string): Promise<{ count: number; sum: number }>;
	userRating(userId: string, comicId: string): Promise<number | null>;

	/** Throws CONFLICT-coded error on duplicate (followerId, creatorId). */
	insertFollow(
		id: string,
		followerId: string,
		creatorId: string,
	): Promise<void>;
	deleteFollow(followerId: string, creatorId: string): Promise<void>;

	/** Throws CONFLICT-coded error when the reporter's open report exists. */
	insertReport(row: NewReportRow): Promise<void>;
};

export type Social = {
	comment(
		viewer: Viewer,
		input: { comicId: string; body: string },
	): Promise<CommentView>;
	listComments(
		viewer: Viewer,
		input: { comicId: string; cursor?: string; limit?: number },
	): Promise<CommentList>;
	deleteComment(viewer: Viewer, commentId: string): Promise<void>;
	rate(
		viewer: Viewer,
		input: { comicId: string; value: number },
	): Promise<RatingSummary>;
	ratingSummary(viewer: Viewer, comicId: string): Promise<RatingSummary>;
	follow(viewer: Viewer, input: { creatorId: string }): Promise<void>;
	unfollow(viewer: Viewer, input: { creatorId: string }): Promise<void>;
	report(
		viewer: Viewer,
		input: {
			targetType: ReportTargetType;
			targetId: string;
			reason: ReportReason;
			note?: string;
		},
	): Promise<void>;
};
