import type { Database } from "@comic/db";
import { createPrismaComicData } from "@comic/reading/adapters/prisma";
import { createSocial } from "@comic/social";
import { createPrismaSocialData } from "@comic/social/adapters/prisma";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { o } from "../index";

const REPORT_REASONS = [
	"sexual_content",
	"copyright",
	"harassment",
	"spam",
	"other",
] as const;

/** Same mapping table publishing uses — invariant 14 keeps it to one. */
async function crossSeam<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		const code = (error as { code?: string }).code;
		const message = (error as Error).message;
		switch (code) {
			case "NOT_FOUND":
				throw new ORPCError("NOT_FOUND", { cause: error });
			case "UNAUTHENTICATED":
				throw new ORPCError("UNAUTHORIZED", { cause: error });
			case "FORBIDDEN":
				throw new ORPCError("FORBIDDEN", { cause: error });
			case "INVALID_INPUT":
				throw new ORPCError("BAD_REQUEST", { message, cause: error });
			case "CONFLICT":
				throw new ORPCError("CONFLICT", { cause: error });
			default:
				throw error;
		}
	}
}

function socialIn(db: Database) {
	return createSocial({
		data: createPrismaSocialData(db),
		// The access lookup reuses the reading adapter verbatim — one query,
		// one canView (invariants 2/3).
		comics: createPrismaComicData(db),
	});
}

const comicRef = z.object({ comicId: z.string().min(1) });

export const socialRouter = {
	comment: o
		.input(comicRef.extend({ body: z.string().min(1).max(2000) }))
		.handler(async ({ input, context }) =>
			crossSeam(() => socialIn(context.db).comment(context.viewer, input)),
		),
	listComments: o
		.input(
			comicRef.extend({
				cursor: z.string().optional(),
				limit: z.number().int().min(1).max(100).optional(),
			}),
		)
		.handler(async ({ input, context }) =>
			crossSeam(() => socialIn(context.db).listComments(context.viewer, input)),
		),
	deleteComment: o
		.input(z.object({ commentId: z.string().min(1) }))
		.handler(async ({ input, context }) =>
			crossSeam(() =>
				socialIn(context.db).deleteComment(context.viewer, input.commentId),
			),
		),
	rate: o
		.input(comicRef.extend({ value: z.number().int().min(1).max(5) }))
		.handler(async ({ input, context }) =>
			crossSeam(() => socialIn(context.db).rate(context.viewer, input)),
		),
	ratingSummary: o
		.input(comicRef)
		.handler(async ({ input, context }) =>
			crossSeam(() =>
				socialIn(context.db).ratingSummary(context.viewer, input.comicId),
			),
		),
	follow: o
		.input(z.object({ creatorId: z.string().min(1) }))
		.handler(async ({ input, context }) =>
			crossSeam(() => socialIn(context.db).follow(context.viewer, input)),
		),
	unfollow: o
		.input(z.object({ creatorId: z.string().min(1) }))
		.handler(async ({ input, context }) =>
			crossSeam(() => socialIn(context.db).unfollow(context.viewer, input)),
		),
	report: o
		.input(
			z.object({
				targetType: z.enum(["comic", "comment"]),
				targetId: z.string().min(1),
				reason: z.enum(REPORT_REASONS),
				note: z.string().max(1000).optional(),
			}),
		)
		.handler(async ({ input, context }) =>
			crossSeam(() => socialIn(context.db).report(context.viewer, input)),
		),
};
