import {
	type ChapterSource,
	createPublishing,
	MAX_CHAPTER_BYTES,
	type PublishingErrorCode,
	type Upload,
} from "@comic/publishing";
import { createPrismaPublishingData } from "@comic/publishing/adapters/prisma";
import { createChapterFilesPort } from "@comic/publishing/adapters/storage-files";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { viewerWithRole } from "./context";
import { auth, getDb, storage } from "./services";

/**
 * Multipart upload route — the door that carries raw chapter bytes.
 * POST /publish/chapters
 * fields: comicId | chapterId, optional title, then EITHER `archive` (one
 * CBZ/ZIP File) OR one-or-more `images` Files.
 * createComic stays on the oRPC router: it moves no files.
 */
export const publishingApp = new Hono();

/**
 * Bun.serve rejects a body past `maxRequestBodySize` (default 128 MB) with an
 * empty 413 before any handler runs, so the runtime limit must sit above the
 * module's own check to keep the error renderable. Multipart framing accounts
 * for the headroom. Verified 2026-09-13: 100 MB → 200, 130 MB → 413 on Bun 1.4.0.
 */
export const MAX_UPLOAD_BYTES = MAX_CHAPTER_BYTES + 8 * 1024 * 1024;

const STATUS: Record<PublishingErrorCode, ContentfulStatusCode> = {
	UNAUTHENTICATED: 401,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	INVALID_INPUT: 400,
	TOO_LARGE: 413,
	LIMIT_EXCEEDED: 400,
	CONFLICT: 409,
};

const uploadOf = async (file: File): Promise<Upload> => ({
	filename: file.name,
	contentType: file.type,
	bytes: new Uint8Array(await file.arrayBuffer()),
});

publishingApp.post("/publish/chapters", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) {
		return c.json({ code: "UNAUTHENTICATED", message: "login required" }, 401);
	}
	// ponytail: formData buffers the whole body in memory before the size
	// check. Ceiling = MAX_CHAPTER_BYTES; upgrade path is a streaming
	// multipart reader when storage itself gains putStream.
	const form = await c.req.formData();
	const comicId = form.get("comicId");
	const chapterId = form.get("chapterId");
	if (typeof comicId !== "string" && typeof chapterId !== "string") {
		return c.json(
			{ code: "INVALID_INPUT", message: "comicId or chapterId required" },
			400,
		);
	}
	const title =
		typeof form.get("title") === "string"
			? (form.get("title") as string)
			: undefined;

	const archive = form.get("archive");
	const images = form
		.getAll("images")
		.filter((f): f is File => f instanceof File);
	if (images.length === 0 && !(archive instanceof File)) {
		return c.json(
			{ code: "INVALID_INPUT", message: "archive or images field required" },
			400,
		);
	}
	const files: readonly File[] = archive instanceof File ? [archive] : images;
	let total = 0;
	for (const f of files) total += f.size;
	if (total > MAX_CHAPTER_BYTES) {
		return c.json(
			{
				code: "TOO_LARGE",
				message: `chapter upload exceeds ${MAX_CHAPTER_BYTES} bytes`,
			},
			413,
		);
	}

	let source: ChapterSource;
	try {
		source =
			archive instanceof File
				? { kind: "archive", upload: await uploadOf(archive) }
				: {
						kind: "images",
						uploads: await Promise.all(images.map(uploadOf)),
					};
	} catch {
		return c.json(
			{ code: "TOO_LARGE", message: "file could not be read" },
			413,
		);
	}

	const publishing = createPublishing({
		data: createPrismaPublishingData(await getDb()),
		files: createChapterFilesPort(storage),
	});
	try {
		const chapter = await publishing.ingestChapter(
			await viewerWithRole(session),
			{
				source,
				target:
					typeof chapterId === "string"
						? { kind: "replaceChapter", chapterId }
						: { kind: "newChapter", comicId: comicId as string, title },
			},
		);
		return c.json(chapter, 201);
	} catch (error) {
		const code = (error as { code?: PublishingErrorCode }).code;
		if (code && code in STATUS) {
			return c.json(
				{
					code,
					message: (error as Error).message,
					filename: (error as { filename?: string }).filename,
				},
				STATUS[code],
			);
		}
		throw error;
	}
});
