import { describe, expect, test } from "bun:test";
import { createMemoryStorage } from "@comic/storage";
import { zipSync } from "fflate";
import { createMemoryPublishingData } from "./adapters/memory";
import { createChapterFilesPort } from "./adapters/storage-files";
import { sniffImageType } from "./images";
import { createPublishing } from "./index";
import {
	MAX_CHAPTER_BYTES,
	MAX_IMAGE_BYTES,
	MAX_PAGES_PER_CHAPTER,
	type Upload,
	type Viewer,
} from "./types";

/* ---------------------------------------------------------------- fixtures */

/**
 * REAL decodable images: ingest now reads dimensions with Bun.Image metadata
 * (social-admin.md decision 8), and an undecodable page is INVALID_INPUT — so
 * the fixtures must survive a real decode. A tiny PNG encoder (zlib via the
 * fflate dep already in this file) covers PNG; Bun.Image itself produces the
 * JPEG and WebP from it. Dimensions are asserted, never guessed.
 */
import { crc32, deflateSync } from "node:zlib";

function makePng(width: number, height: number): Uint8Array {
	const chunk = (type: string, data: Uint8Array): number[] => {
		const td = new TextEncoder().encode(type);
		const len = new Uint8Array(4);
		new DataView(len.buffer).setUint32(0, data.length);
		const body = new Uint8Array(td.length + data.length);
		body.set(td);
		body.set(data, td.length);
		const crc = new Uint8Array(4);
		new DataView(crc.buffer).setUint32(0, crc32(body) >>> 0);
		return [...len, ...body, ...crc];
	};
	const ihdr = new Uint8Array(13);
	const dv = new DataView(ihdr.buffer);
	dv.setUint32(0, width);
	dv.setUint32(4, height);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // truecolor RGB
	const rows: number[] = [];
	for (let y = 0; y < height; y++) {
		rows.push(0); // filter: none
		for (let x = 0; x < width * 3; x++) rows.push((x + y) % 256);
	}
	return new Uint8Array([
		...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
		...chunk("IHDR", ihdr),
		...chunk("IDAT", new Uint8Array(deflateSync(Buffer.from(rows)))),
		...chunk("IEND", new Uint8Array(0)),
	]);
}

const toBytes = (b: ArrayBuffer | Uint8Array): Uint8Array =>
	b instanceof Uint8Array ? b : new Uint8Array(b);

// 4×6 PNG and the JPEG (6×4 after a 90° rotate) + WebP derived from it.
const PNG = makePng(4, 6);
const PNG_20X10 = makePng(20, 10);
const JPEG = toBytes(
	await new Bun.Image(PNG).rotate(90).jpeg({ quality: 70 }).toBuffer(),
);
const WEBP = toBytes(await new Bun.Image(PNG).webp({ quality: 70 }).toBuffer());
/** Sniffs as PNG magic but cannot decode — the rejected-file case. */
const GARBAGE_PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9,
]);

const dimsOf = async (bytes: Uint8Array) => new Bun.Image(bytes).metadata();

function upload(name: string, bytes: Uint8Array): Upload {
	return { filename: name, contentType: "application/octet-stream", bytes };
}

function cbz(entries: Record<string, Uint8Array>): Upload {
	return upload("chapter.cbz", zipSync(entries));
}

const OWNER: Viewer = { kind: "user", id: "u-owner", role: "creator" };
const ADMIN: Viewer = { kind: "user", id: "u-admin", role: "admin" };
const READER: Viewer = { kind: "user", id: "u-reader", role: "reader" };
const OTHER: Viewer = { kind: "user", id: "u-other", role: "creator" };
const ANON: Viewer = { kind: "anonymous" };

/* ------------------------------------------------------------------ harness */

function setup(comics?: { id: string; slug: string; ownerId: string }[]) {
	const data = createMemoryPublishingData({
		comics: (comics ?? [{ id: "c1", slug: "s1", ownerId: "u-owner" }]).map(
			(c) => ({
				...c,
				title: c.id,
				synopsis: null,
				genres: [],
				visibility: "private" as const,
			}),
		),
	});
	const storage = createMemoryStorage();
	const files = createChapterFilesPort(storage);
	const publishing = createPublishing({ data, files });
	return { data, storage, files, publishing };
}

const errorOf = async (
	fn: () => Promise<unknown>,
): Promise<{ code: string; message: string; filename?: string }> => {
	try {
		await fn();
		return { code: "NO_ERROR", message: "" };
	} catch (error) {
		const e = error as { code?: string; message: string; filename?: string };
		return {
			code: e.code ?? "UNKNOWN",
			message: e.message,
			filename: e.filename,
		};
	}
};

const keysOf = (
	data: ReturnType<typeof setup>["data"],
	chapterId: string,
): string[] =>
	[...(data.chapterPages.get(chapterId) ?? [])]
		.sort((a, b) => a.number - b.number)
		.map((r) => r.storageKey);

/* ------------------------------------------------------------------- tests */

describe("publishing — interface tests (docs/design/write-path.md)", () => {
	// 1. Creator ingests a CBZ → natural page order, ordinal, cover set.
	test("1. CBZ ingest: pages 1..N in natural order, ordinal assigned, cover = first page", async () => {
		const { data, storage, publishing } = setup();
		const chapter = await publishing.ingestChapter(OWNER, {
			source: {
				kind: "archive",
				upload: cbz({
					"page1.png": PNG,
					"page2.png": PNG,
					"page10.png": PNG,
					"ComicInfo.xml": new TextEncoder().encode("<xml/>"),
				}),
			},
			target: { kind: "newChapter", comicId: "c1" },
		});
		expect(chapter.ordinal).toBe(1);
		expect(chapter.pageCount).toBe(3);
		const keys = keysOf(data, chapter.id);
		expect(keys.length).toBe(3);
		// natural order: page1→1, page2→2, page10→3 (never page1,page10,page2)
		expect(keys.map((k) => k.split("/").pop())).toEqual([
			"1.png",
			"2.png",
			"3.png",
		]);
		// cover follows the first chapter = page 1, served via /pages/:id
		const comic = data.comics.find((c) => c.id === "c1");
		const page1 = data.chapterPages
			.get(chapter.id)!
			.find((r) => r.number === 1);
		expect(comic?.coverUrl).toBe(`/pages/${page1?.id}`);
		for (const key of keys) {
			expect(await storage.get(key)).not.toBeNull();
		}
		// second chapter gets ordinal 2 and does NOT overwrite the cover
		const second = await publishing.ingestChapter(OWNER, {
			source: { kind: "images", uploads: [upload("a.png", PNG)] },
			target: { kind: "newChapter", comicId: "c1" },
		});
		expect(second.ordinal).toBe(2);
		expect(data.comics.find((c) => c.id === "c1")?.coverUrl).toBe(
			`/pages/${page1?.id}`,
		);
	});

	// 2. Loose images with the same names → same page order as the archive.
	//    Distinct bytes per page make the order observable via contentType.
	test("2. images source matches archive ordering", async () => {
		const a = setup();
		const b = setup();
		const filesByName = [
			["page1.png", PNG],
			["page2.png", WEBP],
			["page10.png", JPEG],
		] as const;
		const viaArchive = await a.publishing.ingestChapter(OWNER, {
			source: {
				kind: "archive",
				upload: cbz(Object.fromEntries(filesByName)),
			},
			target: { kind: "newChapter", comicId: "c1" },
		});
		const viaImages = await b.publishing.ingestChapter(OWNER, {
			source: {
				kind: "images",
				uploads: filesByName.map(([n, x]) => upload(n, x)),
			},
			target: { kind: "newChapter", comicId: "c1" },
		});
		const order = (d: typeof a.data, id: string) =>
			[...(d.chapterPages.get(id) ?? [])]
				.sort((x, y) => x.number - y.number)
				.map((r) => r.contentType);
		expect(order(b.data, viaImages.id)).toEqual([
			"image/png",
			"image/webp",
			"image/jpeg",
		]);
		expect(order(a.data, viaArchive.id)).toEqual(order(b.data, viaImages.id));
	});

	// 3. AuthZ matrix.
	test("3. reader / unrelated creator / anonymous / missing comic", async () => {
		const { publishing } = setup();
		const input = {
			source: { kind: "images", uploads: [upload("p.png", PNG)] },
			target: { kind: "newChapter", comicId: "c1" },
		} as const;
		expect(
			(await errorOf(() => publishing.ingestChapter(READER, input))).code,
		).toBe("FORBIDDEN");
		expect(
			(await errorOf(() => publishing.ingestChapter(OTHER, input))).code,
		).toBe("FORBIDDEN");
		expect(
			(await errorOf(() => publishing.ingestChapter(ANON, input))).code,
		).toBe("UNAUTHENTICATED");
		expect(
			(
				await errorOf(() =>
					publishing.ingestChapter(OWNER, {
						source: input.source,
						target: { kind: "newChapter", comicId: "nope" },
					}),
				)
			).code,
		).toBe("NOT_FOUND");
		// admin may ingest into someone else's comic
		expect((await publishing.ingestChapter(ADMIN, input)).pageCount).toBe(1);
		// createComic follows the same role rule
		expect(
			(await errorOf(() => publishing.createComic(READER, { title: "x" })))
				.code,
		).toBe("FORBIDDEN");
		expect(
			(await errorOf(() => publishing.createComic(ANON, { title: "x" }))).code,
		).toBe("UNAUTHENTICATED");
	});

	// 4. Limits.
	test("4. TOO_LARGE before any write; per-image limit names the file; page cap", async () => {
		const { publishing, storage, data } = setup();
		const big = new Uint8Array(MAX_CHAPTER_BYTES + 1);
		big.set(JPEG, 0);
		const err = await errorOf(() =>
			publishing.ingestChapter(OWNER, {
				source: { kind: "images", uploads: [upload("p.jpg", big)] },
				target: { kind: "newChapter", comicId: "c1" },
			}),
		);
		expect(err.code).toBe("TOO_LARGE");
		expect(storage.size()).toBe(0);
		expect(data.chapterPages.size).toBe(0);

		const six = new Uint8Array(MAX_IMAGE_BYTES + 1);
		six.set(JPEG, 0);
		const imgErr = await errorOf(() =>
			publishing.ingestChapter(OWNER, {
				source: { kind: "images", uploads: [upload("fat.png", six)] },
				target: { kind: "newChapter", comicId: "c1" },
			}),
		);
		expect(imgErr.code).toBe("TOO_LARGE");
		expect(imgErr.filename).toBe("fat.png");
		expect(storage.size()).toBe(0);

		const many = Array.from({ length: MAX_PAGES_PER_CHAPTER + 1 }, (_, i) =>
			upload(`page${i}.png`, PNG),
		);
		expect(
			(
				await errorOf(() =>
					publishing.ingestChapter(OWNER, {
						source: { kind: "images", uploads: many },
						target: { kind: "newChapter", comicId: "c1" },
					}),
				)
			).code,
		).toBe("LIMIT_EXCEEDED");
		expect(storage.size()).toBe(0);
	});

	// 5. Sniffing beats claims.
	test("5. JPEG bytes named .png are stored as image/jpeg under a .jpg key", async () => {
		const { publishing, storage, data } = setup();
		const chapter = await publishing.ingestChapter(OWNER, {
			source: { kind: "images", uploads: [upload("page1.png", JPEG)] },
			target: { kind: "newChapter", comicId: "c1" },
		});
		const row = data.chapterPages.get(chapter.id)![0]!;
		expect(row.contentType).toBe("image/jpeg");
		expect(row.storageKey).toMatch(/\.jpg$/);
		const stored = await storage.get(row.storageKey);
		expect(stored?.contentType).toBe("image/jpeg");
	});

	// 6. Archive hygiene.
	test("6. non-image entries ignored; xml-only and truncated archives → INVALID_INPUT", async () => {
		const { publishing, storage } = setup();
		const mixed = await publishing.ingestChapter(OWNER, {
			source: {
				kind: "archive",
				upload: cbz({
					"ComicInfo.xml": new TextEncoder().encode("<x/>"),
					"__MACOSX/._page1.png": new Uint8Array([0, 1, 2]),
					"notes.txt": new TextEncoder().encode("hi"),
					"page1.png": PNG,
				}),
			},
			target: { kind: "newChapter", comicId: "c1" },
		});
		expect(mixed.pageCount).toBe(1);

		expect(
			(
				await errorOf(() =>
					publishing.ingestChapter(OWNER, {
						source: {
							kind: "archive",
							upload: cbz({
								"ComicInfo.xml": new TextEncoder().encode("<x/>"),
							}),
						},
						target: { kind: "newChapter", comicId: "c1" },
					}),
				)
			).code,
		).toBe("INVALID_INPUT");

		// Cut inside the first local file header: no entry can complete, and
		// the trailing bytes fail the central-directory check → INVALID_INPUT.
		const good = zipSync({ "page1.png": PNG, "page2.png": JPEG });
		const truncated = good.slice(0, 12);
		const before = storage.size();
		expect(
			(
				await errorOf(() =>
					publishing.ingestChapter(OWNER, {
						source: {
							kind: "archive",
							upload: upload("broken.cbz", truncated),
						},
						target: { kind: "newChapter", comicId: "c1" },
					}),
				)
			).code,
		).toBe("INVALID_INPUT");
		expect(storage.size()).toBe(before);
	});

	// 7. Malicious names never reach storage keys.
	test("7. zip-slip names: traversal/absolute entry names are just names", async () => {
		const { publishing, data } = setup();
		const chapter = await publishing.ingestChapter(OWNER, {
			source: {
				kind: "archive",
				upload: cbz({
					"../../etc/passwd.png": PNG,
					"/abs/path.png": PNG,
					"C:\\evil\\pagez.png": PNG,
					"just-txt": JPEG,
				}),
			},
			target: { kind: "newChapter", comicId: "c1" },
		});
		const keys = data.chapterPages.get(chapter.id)!.map((r) => r.storageKey);
		expect(keys.length).toBe(4);
		for (const k of keys) {
			expect(k).not.toContain("..");
			expect(k).not.toContain("\\");
			expect(k).toMatch(/^comics\/c1\/chapters\/[^/]+\/\d+\.(png|jpg)$/);
			expect(k.startsWith("/")).toBe(false);
		}
	});

	// 8. Files port throws mid-write → nothing left behind.
	test("8. failing put unwinds every written key and creates no rows", async () => {
		const { data, storage } = setup();
		const real = createChapterFilesPort(storage);
		let puts = 0;
		const exploding: typeof real = {
			async put(key, file) {
				puts++;
				if (puts === 2) throw new Error("disk full");
				await real.put(key, file);
			},
			delete: (k) => real.delete(k),
		};
		const pub = createPublishing({ data, files: exploding });
		const err = await errorOf(() =>
			pub.ingestChapter(OWNER, {
				source: {
					kind: "archive",
					upload: cbz({ "p1.png": PNG, "p2.png": PNG, "p3.png": PNG }),
				},
				target: { kind: "newChapter", comicId: "c1" },
			}),
		);
		expect(err.message).toBe("disk full"); // raw failure propagates…
		expect(data.chapterPages.size).toBe(0); // …zero Chapter/Page rows…
		expect(storage.size()).toBe(0); // …and zero leftover keys
	});

	// 9. Concurrent ingests get distinct ordinals.
	test("9. two concurrent ingests → distinct ordinals, both committed", async () => {
		const { publishing, data } = setup();
		const run = (n: number) =>
			publishing.ingestChapter(OWNER, {
				source: { kind: "images", uploads: [upload(`p${n}.png`, PNG)] },
				target: { kind: "newChapter", comicId: "c1" },
			});
		const [a, b] = await Promise.all([run(1), run(2)]);
		expect([a.ordinal, b.ordinal].sort((x, y) => x - y)).toEqual([1, 2]);
		expect(data.chapterPages.size).toBe(2);
	});

	// 10. replaceChapter happy path + failure path.
	test("10. replaceChapter: commit swaps keys; failure keeps old chapter intact", async () => {
		const { publishing, data, storage } = setup();
		const first = await publishing.ingestChapter(OWNER, {
			source: {
				kind: "archive",
				upload: cbz({ "p1.png": PNG, "p2.png": PNG }),
			},
			target: { kind: "newChapter", comicId: "c1" },
		});
		const oldKeys = keysOf(data, first.id);

		const replaced = await publishing.ingestChapter(OWNER, {
			source: { kind: "images", uploads: [upload("only.png", JPEG)] },
			target: { kind: "replaceChapter", chapterId: first.id },
		});
		expect(replaced.pageCount).toBe(1);
		expect(replaced.ordinal).toBe(first.ordinal);
		expect(replaced.title).toBe(first.title);
		const newKeys = keysOf(data, first.id);
		for (const k of oldKeys) expect(newKeys).not.toContain(k);
		for (const k of newKeys) expect(await storage.get(k)).not.toBeNull();
		for (const k of oldKeys) expect(await storage.get(k)).toBeNull();

		// failure during replace: old rows AND old bytes survive
		const fresh = await publishing.ingestChapter(OWNER, {
			source: { kind: "images", uploads: [upload("z.png", PNG)] },
			target: { kind: "replaceChapter", chapterId: first.id },
		});
		const currentKeys = keysOf(data, fresh.id);
		const real = createChapterFilesPort(storage);
		let puts = 0;
		const exploding: typeof real = {
			async put(key, file) {
				puts++;
				if (puts === 1) throw new Error("disk full");
				await real.put(key, file);
			},
			delete: (k) => real.delete(k),
		};
		const pub2 = createPublishing({ data, files: exploding });
		const err = await errorOf(() =>
			pub2.ingestChapter(OWNER, {
				source: { kind: "images", uploads: [upload("bad.png", PNG)] },
				target: { kind: "replaceChapter", chapterId: first.id },
			}),
		);
		expect(err.message).toBe("disk full");
		expect(keysOf(data, first.id)).toEqual(currentKeys); // old rows intact
		for (const k of currentKeys) {
			expect(await storage.get(k)).not.toBeNull(); // old keys untouched
		}
	});

	// invariants the ten imply but don't name outright
	test("11. data-port CONFLICT surfaces as retriable CONFLICT", async () => {
		const { publishing, data, storage } = setup();
		const insert = data.insertChapter.bind(data);
		data.insertChapter = async (row) => {
			await insert(row); // pretend the rival committed first
			const err = new Error("(comicId, ordinal)");
			(err as { code?: string }).code = "CONFLICT";
			throw err;
		};
		const res = await errorOf(() =>
			publishing.ingestChapter(OWNER, {
				source: { kind: "images", uploads: [upload("p.png", PNG)] },
				target: { kind: "newChapter", comicId: "c1" },
			}),
		);
		expect(res.code).toBe("CONFLICT");
		expect(storage.size()).toBe(0); // cleanup ran even on CONFLICT
	});

	test("12. createComic mints slug, defaults private+draft, honours claimed slug", async () => {
		const { data, publishing } = setup();
		const comic = await publishing.createComic(OWNER, {
			title: "Sci-Fi Heroes!!",
		});
		expect(comic.slug).toBe("sci-fi-heroes");
		expect(comic.visibility).toBe("private");
		expect(comic.status).toBe("draft");
		await publishing.createComic(OWNER, { title: "Sci-Fi Heroes!!" });
		expect(data.comics.map((c) => c.slug)).toContain("sci-fi-heroes-2");
		const taken = await errorOf(() =>
			publishing.createComic(OWNER, { title: "x", slug: "sci-fi-heroes" }),
		);
		expect(taken.code).toBe("CONFLICT");
	});

	test("13. oversized archive member is TOO_LARGE naming the entry; non-image overflow is dropped", async () => {
		const { publishing } = setup();
		const fat = new Uint8Array(MAX_IMAGE_BYTES + 100);
		fat.set(PNG, 0);
		const err = await errorOf(() =>
			publishing.ingestChapter(OWNER, {
				source: {
					kind: "archive",
					upload: cbz({
						"page1.png": fat,
						"readme.txt": new Uint8Array([1, 2]),
					}),
				},
				target: { kind: "newChapter", comicId: "c1" },
			}),
		);
		expect(err.code).toBe("TOO_LARGE");
		expect(err.filename).toBe("page1.png");
	});

	// 11 (spec). Ingest stores REAL dimensions; undecodable image → INVALID_INPUT naming the file.
	test("14. dimensions captured for PNG and JPEG; garbage PNG named and rejected with nothing written", async () => {
		const { publishing, data, storage } = setup();
		const chapter = await publishing.ingestChapter(OWNER, {
			source: {
				kind: "images",
				uploads: [upload("a.png", PNG), upload("b.jpg", JPEG)],
			},
			target: { kind: "newChapter", comicId: "c1" },
		});
		const rows = [...data.chapterPages.get(chapter.id)!.values()].sort(
			(x, y) => x.number - y.number,
		);
		expect(rows[0]).toMatchObject({ width: 4, height: 6 });
		// the JPEG fixture is the 4×6 PNG rotated 90° — dimensions must follow
		const jpegMeta = await dimsOf(JPEG);
		expect(rows[1]).toMatchObject({
			width: jpegMeta.width,
			height: jpegMeta.height,
		});
		expect(rows[1].width * rows[1].height).toBe(24);

		const before = storage.size();
		const err = await errorOf(() =>
			publishing.ingestChapter(OWNER, {
				source: {
					kind: "images",
					uploads: [
						upload("good.png", PNG_20X10),
						upload("broken.png", GARBAGE_PNG),
					],
				},
				target: { kind: "newChapter", comicId: "c1" },
			}),
		);
		expect(err.code).toBe("INVALID_INPUT");
		expect(err.filename).toBe("broken.png");
		// nothing from the bad batch reaches storage (invariant 5's unwind)
		expect(storage.size()).toBe(before);
		expect(data.chapterPages.size).toBe(1);
	});

	test("sniff helper agrees with the archive path (WEBP)", () => {
		expect(sniffImageType(WEBP)).toBe("image/webp");
		expect(sniffImageType(new Uint8Array([1, 2, 3]))).toBeNull();
	});
});
