import {
	createPublishing,
	MAX_IMAGE_BYTES,
	MAX_PAGES_PER_CHAPTER,
	type Upload,
} from "@comic/publishing";
import { createPrismaPublishingData } from "@comic/publishing/adapters/prisma";
import { createChapterFilesPort } from "@comic/publishing/adapters/storage-files";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import type { Context } from "../context";
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

const comicDraft = z.object({
	title: z.string().min(1).max(200),
	slug: z
		.string()
		.min(3)
		.max(96)
		.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
		.optional(),
	synopsis: z.string().max(5000).nullish(),
	genres: z.array(z.enum(GENRES)).max(12).optional(),
	visibility: z.enum(["public", "unlisted", "private"]).optional(),
});

/** oRPC serialises File through its FormData channel; sizes stay advisory —
 * the module sniffs bytes and enforces the real limits. */
const ingestInput = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("archive"),
		comicId: z.string().min(1),
		title: z.string().max(200).optional(),
		archive: z.file(),
	}),
	z.object({
		kind: z.literal("images"),
		comicId: z.string().min(1),
		title: z.string().max(200).optional(),
		images: z.array(z.file()).min(1).max(MAX_PAGES_PER_CHAPTER),
	}),
	z.object({
		kind: z.literal("replaceChapter"),
		chapterId: z.string().min(1),
		archive: z.file().optional(),
		images: z.array(z.file()).min(1).max(MAX_PAGES_PER_CHAPTER).optional(),
	}),
]);

const uploadOf = async (file: File): Promise<Upload> => ({
	filename: file.name,
	contentType: file.type,
	bytes: new Uint8Array(await file.arrayBuffer()),
});

/** Trust-boundary pre-check: refuse to buffer an over-limit image at all.
 * The module re-checks after sniffing (advisory size can lie less often than
 * a filename, but not at all). */
function assertFileSizes(files: readonly File[]): void {
	for (const f of files) {
		if (f.size > MAX_IMAGE_BYTES) {
			throw new ORPCError("CONTENT_TOO_LARGE", {
				message: `image exceeds ${MAX_IMAGE_BYTES} bytes`,
			});
		}
	}
}

async function crossSeam<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		const code = (error as { code?: string }).code;
		const message = (error as Error).message;
		const filename = (error as { filename?: string }).filename;
		switch (code) {
			case "NOT_FOUND":
				throw new ORPCError("NOT_FOUND", { cause: error });
			case "UNAUTHENTICATED":
				throw new ORPCError("UNAUTHORIZED", { cause: error });
			case "FORBIDDEN":
				throw new ORPCError("FORBIDDEN", { cause: error });
			case "INVALID_INPUT":
				throw new ORPCError("BAD_REQUEST", {
					message,
					cause: error,
					data: { filename },
				});
			case "TOO_LARGE":
				throw new ORPCError("CONTENT_TOO_LARGE", {
					message,
					cause: error,
					data: { filename },
				});
			case "LIMIT_EXCEEDED":
				throw new ORPCError("BAD_REQUEST", {
					message,
					cause: error,
					data: { filename, limit: true },
				});
			case "CONFLICT":
				throw new ORPCError("CONFLICT", { cause: error });
			default:
				throw error;
		}
	}
}

function publishingIn(context: Context) {
	return createPublishing({
		data: createPrismaPublishingData(context.db),
		files: createChapterFilesPort(context.storage),
	});
}

export const publishingRouter = {
	createComic: o
		.input(comicDraft)
		.handler(async ({ input, context }) =>
			crossSeam(() => publishingIn(context).createComic(context.viewer, input)),
		),

	ingestChapter: o.input(ingestInput).handler(async ({ input, context }) =>
		crossSeam(async () => {
			const pub = publishingIn(context);
			if (input.kind === "archive") {
				return await pub.ingestChapter(context.viewer, {
					source: { kind: "archive", upload: await uploadOf(input.archive) },
					target: {
						kind: "newChapter",
						comicId: input.comicId,
						title: input.title,
					},
				});
			}
			if (input.kind === "images") {
				assertFileSizes(input.images);
				return await pub.ingestChapter(context.viewer, {
					source: {
						kind: "images",
						uploads: await Promise.all(input.images.map(uploadOf)),
					},
					target: {
						kind: "newChapter",
						comicId: input.comicId,
						title: input.title,
					},
				});
			}
			// replaceChapter
			if (input.archive) {
				return await pub.ingestChapter(context.viewer, {
					source: { kind: "archive", upload: await uploadOf(input.archive) },
					target: { kind: "replaceChapter", chapterId: input.chapterId },
				});
			}
			assertFileSizes(input.images ?? []);
			return await pub.ingestChapter(context.viewer, {
				source: {
					kind: "images",
					uploads: await Promise.all((input.images ?? []).map(uploadOf)),
				},
				target: { kind: "replaceChapter", chapterId: input.chapterId },
			});
		}),
	),
};
