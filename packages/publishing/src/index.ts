import { type ExtractedEntry, extractArchive } from "./archive";
import { newId, slugify, variantSlug } from "./ids";
import type { SniffedType } from "./images";
import {
	assertEachWithinImageLimit,
	extForType,
	imageDimensions,
	naturalCompare,
	sniffImageType,
} from "./images";
import type {
	ChapterFilesPort,
	ChapterSource,
	ChapterSummary,
	ComicCard,
	ComicDraft,
	IngestInput,
	NewPageRow,
	Publishing,
	PublishingDataPort,
	Upload,
	Viewer,
} from "./types";
import {
	MAX_CHAPTER_BYTES,
	MAX_PAGES_PER_CHAPTER,
	publishingError,
} from "./types";

export * from "./types";

/**
 * Key minting (invariant 4): `comics/<comicId>/chapters/<chapterId>/<number>.<ext>`.
 * A replace-ingest reuses the chapter id, so its keys gain an ingest-scoped
 * subdirectory — otherwise new keys would collide with the very old keys they
 * must leave untouched until commit (invariants 5/6, test 10).
 */
function pageKey(opts: {
	comicId: string;
	chapterId: string;
	batch: string | null;
	number: number;
	ext: string;
}): string {
	const scope = opts.batch ? `${opts.chapterId}/${opts.batch}` : opts.chapterId;
	return `comics/${opts.comicId}/chapters/${scope}/${opts.number}.${opts.ext}`;
}

function currentUserId(viewer: Viewer): string {
	if (viewer.kind === "anonymous") {
		throw publishingError("UNAUTHENTICATED", "login required");
	}
	return viewer.id;
}

/** Invariant 1: owner or admin may write; missing comic and hidden comic both NOT_FOUND. */
async function writableComic(
	data: PublishingDataPort,
	viewer: Viewer,
	comicId: string,
) {
	const userId = currentUserId(viewer);
	const comic = await data.findComic(comicId);
	if (!comic) throw publishingError("NOT_FOUND", "comic not found");
	const isAdmin = viewer.kind === "user" && viewer.role === "admin";
	if (comic.ownerId !== userId && !isAdmin) {
		throw publishingError("FORBIDDEN", "you do not own this comic");
	}
	return comic;
}

type PreparedPage = {
	contentType: SniffedType;
	bytes: Uint8Array;
	sourceName: string;
};

function finishPages(
	pages: PreparedPage[],
	filenameForError?: string,
): PreparedPage[] {
	if (pages.length === 0) {
		throw publishingError(
			"INVALID_INPUT",
			"no page images found",
			filenameForError,
		);
	}
	if (pages.length > MAX_PAGES_PER_CHAPTER) {
		throw publishingError(
			"LIMIT_EXCEEDED",
			`more than ${MAX_PAGES_PER_CHAPTER} pages in one chapter`,
			filenameForError,
		);
	}
	// Invariant 3: natural order, 1-based numbering comes later.
	return pages.sort((a, b) => naturalCompare(a.sourceName, b.sourceName));
}

function preparedFromImages(uploads: readonly Upload[]): PreparedPage[] {
	if (uploads.length === 0) {
		throw publishingError("INVALID_INPUT", "no files uploaded");
	}
	const pages: PreparedPage[] = [];
	for (const u of uploads) {
		const t = sniffImageType(u.bytes);
		if (!t) {
			throw publishingError(
				"INVALID_INPUT",
				"file is not a supported image (jpeg, png, webp, gif, avif)",
				u.filename,
			);
		}
		pages.push({ contentType: t, bytes: u.bytes, sourceName: u.filename });
	}
	return finishPages(pages);
}

async function preparedFromArchive(upload: Upload): Promise<PreparedPage[]> {
	let entries: ExtractedEntry[];
	try {
		entries = await extractArchive(upload.bytes, upload.filename);
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code === "TOO_LARGE" || code === "LIMIT_EXCEEDED") throw error;
		throw publishingError(
			"INVALID_INPUT",
			`could not read archive: ${(error as Error).message}`,
			upload.filename,
		);
	}
	const pages: PreparedPage[] = [];
	for (const e of entries) {
		const t = sniffImageType(e.bytes);
		if (!t) continue; // invariant 11: ComicInfo.xml, __MACOSX, .txt — names are just names
		if (e.oversized) {
			// Sniffed as an image but the extractor refused to buffer past the
			// per-entry cap — that is a size failure, naming the entry.
			throw publishingError(
				"TOO_LARGE",
				"image exceeds the per-image size limit",
				e.name,
			);
		}
		pages.push({ contentType: t, bytes: e.bytes, sourceName: e.name });
	}
	return finishPages(pages, upload.filename);
}

/** Invariant 8, up front: summed payload vs MAX_CHAPTER_BYTES before anything
 * else. Per-image MAX_IMAGE_BYTES applies to loose images; archive members are
 * capped during extraction (the container itself may legitimately exceed it). */
function assertUploadLimits(source: ChapterSource): void {
	const uploads = source.kind === "archive" ? [source.upload] : source.uploads;
	let total = 0;
	for (const u of uploads) total += u.bytes.length;
	if (total > MAX_CHAPTER_BYTES) {
		throw publishingError(
			"TOO_LARGE",
			`chapter upload exceeds ${MAX_CHAPTER_BYTES} bytes`,
		);
	}
	if (source.kind === "images") assertEachWithinImageLimit(source.uploads);
}

export function createPublishing(deps: {
	data: PublishingDataPort;
	files: ChapterFilesPort;
}): Publishing {
	const { data, files } = deps;

	return {
		async createComic(viewer: Viewer, draft: ComicDraft): Promise<ComicCard> {
			const userId = currentUserId(viewer);
			if (viewer.kind === "user" && viewer.role === "reader") {
				throw publishingError(
					"FORBIDDEN",
					"creator role required to publish comics",
				);
			}
			const title = draft.title.trim();
			if (!title) throw publishingError("INVALID_INPUT", "title is required");

			const claimed = draft.slug?.trim();
			let slug: string;
			if (claimed) {
				if (await data.slugTaken(claimed)) {
					throw publishingError("CONFLICT", "slug already taken");
				}
				slug = claimed;
			} else {
				const base = slugify(title) || "comic";
				slug = await variantSlug(base, (s) => data.slugTaken(s));
			}

			// Invariant 12: a new comic is always private + draft.
			return data.insertComic({
				id: newId(),
				slug,
				title,
				synopsis: draft.synopsis?.trim() || null,
				ownerId: userId,
				genres: [...(draft.genres ?? [])],
				visibility: draft.visibility ?? "private",
			});
		},

		async ingestChapter(
			viewer: Viewer,
			input: IngestInput,
		): Promise<ChapterSummary> {
			const { source, target } = input;

			let comicId: string;
			if (target.kind === "newChapter") {
				comicId = target.comicId;
			} else {
				const chapter = await data.findChapter(target.chapterId);
				if (!chapter) throw publishingError("NOT_FOUND", "chapter not found");
				comicId = chapter.comicId;
			}
			const comic = await writableComic(data, viewer, comicId);

			// Limits before any extraction or write (invariant 8)…
			assertUploadLimits(source);
			const pages =
				source.kind === "archive"
					? await preparedFromArchive(source.upload)
					: preparedFromImages(source.uploads);

			const chapterId =
				target.kind === "newChapter" ? newId() : target.chapterId;
			const batch = target.kind === "replaceChapter" ? newId() : null;

			const written: string[] = [];
			const cleanup = async () => {
				for (const key of written) {
					try {
						await files.delete(key);
					} catch {
						// best-effort; orphan bytes stay unreachable (invariant 7)
					}
				}
			};

			try {
				// Invariant 5: every file before any row. A failed put unwinds
				// what was written and never reaches the database.
				// Dimensions decode BEFORE any storage write (decision 8): an
				// image Bun.Image cannot decode must never reach a Page row —
				// it would break the reader's layout reservation.
				const rows: NewPageRow[] = [];
				for (const [i, p] of pages.entries()) {
					const dims = await imageDimensions(p.bytes);
					if (!dims) {
						throw publishingError(
							"INVALID_INPUT",
							"image could not be decoded — the reader cannot lay it out",
							p.sourceName,
						);
					}
					const number = i + 1;
					const key = pageKey({
						comicId: comic.id,
						chapterId,
						batch,
						number,
						ext: extForType(p.contentType),
					});
					await files.put(key, { bytes: p.bytes, contentType: p.contentType });
					written.push(key);
					rows.push({
						id: newId(),
						number,
						storageKey: key,
						contentType: p.contentType,
						width: dims.width,
						height: dims.height,
					});
				}

				if (target.kind === "newChapter") {
					// Invariant 9: ordinal assignment lives inside the adapter's
					// transaction; a unique-violation arrives as CONFLICT (retriable).
					return await data.insertChapter({
						id: chapterId,
						comicId: comic.id,
						title: target.title?.trim() || "",
						pages: rows,
					});
				}

				// replaceChapter: new keys are stored; the transaction swaps rows;
				// only AFTER commit are the replaced keys deleted (invariant 5).
				const { replacedKeys, chapter } = await data.replaceChapterPages(
					chapterId,
					rows,
				);
				for (const key of replacedKeys) {
					try {
						await files.delete(key);
					} catch {
						// lingering old bytes are unreachable — invariant 7's ceiling
					}
				}
				return chapter;
			} catch (error) {
				await cleanup();
				throw error;
			}
		},
	};
}
