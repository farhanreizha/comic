import { ANONYMOUS, createReading, type Viewer } from "@comic/reading";
import { createPrismaComicData } from "@comic/reading/adapters/prisma";
import { createStorageFilesPort } from "@comic/reading/adapters/storage-files";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { o } from "../index";

const GENRES = [
	"action",
	"adventure",
	"comedy",
	"drama",
	"fantasy",
	"horror",
	"mystery",
	"romance",
	"sci-fi",
	"slice-of-life",
	"sports",
	"thriller",
] as const;

const browseQuery = z.object({
	q: z.string().max(200).optional(),
	genre: z.enum(GENRES).optional(),
	cursor: z.string().optional(),
	limit: z.number().int().min(1).max(100).optional(),
});

const readRef = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("comic"),
		ref: z.union([
			z.object({ id: z.string().min(1) }),
			z.object({ slug: z.string().min(1) }),
		]),
	}),
	z.object({ kind: z.literal("chapter"), chapterId: z.string().min(1) }),
	z.object({ kind: z.literal("page"), pageId: z.string().min(1) }),
]);

export const viewerFromSession = (
	session: { user: { id: string; role?: string } } | null | undefined,
): Viewer => {
	if (!session) return ANONYMOUS;
	const role =
		session.user.role === "creator" || session.user.role === "admin"
			? session.user.role
			: "reader";
	return { kind: "user", id: session.user.id, role };
};

/** Invariant 8: the module stays transport-agnostic; codes map here. */
async function crossSeam<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code === "NOT_FOUND")
			throw new ORPCError("NOT_FOUND", { cause: error });
		if (code === "UNAUTHENTICATED")
			throw new ORPCError("UNAUTHORIZED", { cause: error });
		if (code === "INVALID_INPUT")
			throw new ORPCError("BAD_REQUEST", { cause: error });
		throw error;
	}
}

export const readingRouter = {
	browse: o.input(browseQuery.nullish()).handler(async ({ input, context }) =>
		crossSeam(() =>
			createReading({
				data: createPrismaComicData(context.db),
				files: createStorageFilesPort(context.storage),
			}).browse(context.viewer, input ?? {}),
		),
	),
	read: o.input(readRef).handler(async ({ input, context }) =>
		crossSeam(async () => {
			const result = await createReading({
				data: createPrismaComicData(context.db),
				files: createStorageFilesPort(context.storage),
			}).read(context.viewer, input);
			// Page bytes ride the image route, not the JSON RPC channel.
			if (result.kind === "page") {
				return { kind: "page" as const, contentType: result.contentType };
			}
			return result;
		}),
	),
	shelf: o.handler(({ context }) =>
		crossSeam(() =>
			createReading({
				data: createPrismaComicData(context.db),
				files: createStorageFilesPort(context.storage),
			}).shelf(context.viewer),
		),
	),
	recordProgress: o
		.input(
			z.object({
				chapterId: z.string().min(1),
				page: z.number().int().min(1),
			}),
		)
		.handler(({ context, input }) =>
			crossSeam(() =>
				createReading({
					data: createPrismaComicData(context.db),
					files: createStorageFilesPort(context.storage),
				}).recordProgress(context.viewer, input.chapterId, input.page),
			),
		),
	saveComic: o
		.input(z.object({ comicId: z.string().min(1) }))
		.handler(({ context, input }) =>
			crossSeam(() =>
				createReading({
					data: createPrismaComicData(context.db),
					files: createStorageFilesPort(context.storage),
				}).saveComic(context.viewer, input.comicId),
			),
		),
	unsaveComic: o
		.input(z.object({ comicId: z.string().min(1) }))
		.handler(({ context, input }) =>
			crossSeam(() =>
				createReading({
					data: createPrismaComicData(context.db),
					files: createStorageFilesPort(context.storage),
				}).unsaveComic(context.viewer, input.comicId),
			),
		),
	isSaved: o
		.input(z.object({ comicId: z.string().min(1) }))
		.handler(({ context, input }) =>
			crossSeam(() =>
				createReading({
					data: createPrismaComicData(context.db),
					files: createStorageFilesPort(context.storage),
				}).isSaved(context.viewer, input.comicId),
			),
		),
	/** The shell needs the viewer's role to gate nav items; sessions don't carry it. */
	me: o.handler(({ context }) => ({
		signedIn: context.viewer.kind === "user",
		role: context.viewer.kind === "user" ? context.viewer.role : null,
		// The id lets the upload page pick its own comics out of browse
		// (creator/admin scope includes public of others).
		id: context.viewer.kind === "user" ? context.viewer.id : null,
	})),
};
