/**
 * `social` — comments, ratings, follows, reports. Framework-free; every
 * rule below is an invariant from docs/design/social-admin.md.
 */

import { randomUUID } from "node:crypto";
import { canView } from "@comic/reading";
import type {
	ComicAccessPort,
	CommentAccessInfo,
	CommentRecord,
	CommentView,
	PageWindow,
	RatingSummary,
	Social,
	SocialDataPort,
	Viewer,
} from "./types";
import {
	MAX_COMMENT_BODY,
	MAX_REPORT_NOTE,
	REPORT_REASONS,
	socialError,
} from "./types";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function currentUserId(viewer: Viewer): string {
	if (viewer.kind === "anonymous") {
		throw socialError("UNAUTHENTICATED", "login required");
	}
	return viewer.id;
}

const isAdmin = (viewer: Viewer): boolean =>
	viewer.kind === "user" && viewer.role === "admin";

/**
 * Invariants 2/3: the comic must exist AND pass canView. Hiding, not
 * forbidding — interacting with a comic you cannot read is NOT_FOUND, and a
 * taken-down comic inherits the denial through the single decision function.
 */
async function viewableComicOrNotFound(
	comics: ComicAccessPort,
	viewer: Viewer,
	comicId: string,
) {
	const comic = await comics.findComic(comicId);
	if (!comic || !canView(viewer, comic)) {
		throw socialError("NOT_FOUND", "comic not found");
	}
	return comic;
}

function toView(r: CommentRecord): CommentView {
	return {
		id: r.id,
		comicId: r.comicId,
		author: { id: r.authorId, name: r.authorName },
		body: r.body,
		hiddenAt: r.hiddenAt,
		createdAt: r.createdAt,
	};
}

/** Cursor for comment windows: `${createdAt.getTime()}\u0000${id}` (ASC order). */
function encodeCursor(r: { createdAt: Date; id: string }): string {
	return `${r.createdAt.getTime()}\u0000${r.id}`;
}

function decodeWindow(cursor: string | undefined, limit: number): PageWindow {
	let after: PageWindow["after"] = null;
	if (cursor !== undefined) {
		const [time, id] = cursor.split("\u0000");
		const ms = Number(time);
		if (time === undefined || id === undefined || !Number.isFinite(ms)) {
			throw socialError("INVALID_INPUT", "invalid cursor");
		}
		after = { createdAt: new Date(ms), id };
	}
	return { after, limit };
}

export function createSocial(deps: {
	data: SocialDataPort;
	comics: ComicAccessPort;
}): Social {
	const { data, comics } = deps;

	async function summaryFor(
		viewer: Viewer,
		comicId: string,
	): Promise<RatingSummary> {
		const agg = await data.ratingAggregate(comicId);
		const userId = viewer.kind === "user" ? viewer.id : null;
		const userValue = userId ? await data.userRating(userId, comicId) : null;
		return {
			average: agg.count === 0 ? null : agg.sum / agg.count,
			count: agg.count,
			userValue,
		};
	}

	async function commentAccessInfo(
		commentId: string,
	): Promise<CommentAccessInfo> {
		const comment = await data.findComment(commentId);
		if (!comment) throw socialError("NOT_FOUND", "comment not found");
		return comment;
	}

	return {
		async comment(viewer, input) {
			const userId = currentUserId(viewer);
			const body = input.body?.trim() ?? "";
			if (!body) throw socialError("INVALID_INPUT", "comment body is required");
			if (body.length > MAX_COMMENT_BODY) {
				throw socialError(
					"INVALID_INPUT",
					`comment body exceeds ${MAX_COMMENT_BODY} characters`,
				);
			}
			await viewableComicOrNotFound(comics, viewer, input.comicId);
			const created = await data.insertComment({
				id: randomUUID(),
				comicId: input.comicId,
				authorId: userId,
				body,
			});
			return toView(created);
		},

		async listComments(viewer, input) {
			// Invariant 1: every entry point is a signed-in action.
			currentUserId(viewer);
			await viewableComicOrNotFound(comics, viewer, input.comicId);
			const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
			if (!Number.isInteger(limit) || limit < 1) {
				throw socialError("INVALID_INPUT", "limit must be a positive integer");
			}
			const window = decodeWindow(input.cursor, limit + 1);
			const includeHidden = isAdmin(viewer);
			const rows = await data.listComments(
				input.comicId,
				window,
				includeHidden,
			);
			const items = rows.slice(0, limit);
			const last = items.at(-1);
			return {
				items: items.map(toView),
				nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
				count: await data.countComments(input.comicId, includeHidden),
			};
		},

		async deleteComment(viewer, commentId) {
			const userId = currentUserId(viewer);
			// Missing comment → NOT_FOUND, same as everything addressable by id.
			const comment = await commentAccessInfo(commentId);
			// Invariant 4: author or admin, whoever else gets FORBIDDEN.
			if (comment.authorId !== userId && !isAdmin(viewer)) {
				throw socialError("FORBIDDEN", "you can only delete your own comment");
			}
			await data.deleteComment(commentId);
		},

		async rate(viewer, input) {
			const userId = currentUserId(viewer);
			// Invariant 6: no clamping.
			if (
				!Number.isInteger(input.value) ||
				input.value < 1 ||
				input.value > 5
			) {
				throw socialError("INVALID_INPUT", "rating must be an integer 1–5");
			}
			await viewableComicOrNotFound(comics, viewer, input.comicId);
			await data.upsertRating(userId, input.comicId, input.value);
			return summaryFor(viewer, input.comicId);
		},

		async ratingSummary(viewer, comicId) {
			currentUserId(viewer);
			await viewableComicOrNotFound(comics, viewer, comicId);
			return summaryFor(viewer, comicId);
		},

		async follow(viewer, input) {
			const userId = currentUserId(viewer);
			if (input.creatorId === userId) {
				throw socialError("INVALID_INPUT", "you cannot follow yourself");
			}
			// Invariant 7: the target must exist and carry the creator role.
			const target = await data.findUserById(input.creatorId);
			if (!target) throw socialError("NOT_FOUND", "user not found");
			if (target.role === "reader") {
				throw socialError("INVALID_INPUT", "can only follow a creator");
			}
			try {
				await data.insertFollow(randomUUID(), userId, input.creatorId);
			} catch (error) {
				if ((error as { code?: string }).code === "CONFLICT") {
					throw socialError("CONFLICT", "already following this creator");
				}
				throw error;
			}
		},

		async unfollow(viewer, input) {
			const userId = currentUserId(viewer);
			await data.deleteFollow(userId, input.creatorId);
		},

		async report(viewer, input) {
			const userId = currentUserId(viewer);
			if (!REPORT_REASONS.includes(input.reason)) {
				throw socialError("INVALID_INPUT", "unknown report reason");
			}
			const note = input.note?.trim() || null;
			if (note && note.length > MAX_REPORT_NOTE) {
				throw socialError(
					"INVALID_INPUT",
					`report note exceeds ${MAX_REPORT_NOTE} characters`,
				);
			}
			// Invariant 8: target must exist and the reporter must see it.
			if (input.targetType === "comic") {
				await viewableComicOrNotFound(comics, viewer, input.targetId);
			} else {
				const comment = await commentAccessInfo(input.targetId);
				await viewableComicOrNotFound(comics, viewer, comment.comicId);
			}
			try {
				await data.insertReport({
					id: randomUUID(),
					targetType: input.targetType,
					targetId: input.targetId,
					reporterId: userId,
					reason: input.reason,
					note,
				});
			} catch (error) {
				if ((error as { code?: string }).code === "CONFLICT") {
					throw socialError(
						"CONFLICT",
						"you already have an open report on this",
					);
				}
				throw error;
			}
		},
	};
}
