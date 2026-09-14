import { describe, expect, test } from "bun:test";
import { createMemoryStorage } from "@comic/storage";
import { browseVisible, canView } from "./access";
import { createMemoryComicData } from "./adapters/memory";
import { createStorageFilesPort } from "./adapters/storage-files";
import { createReading } from "./index";
import { ANONYMOUS, type ComicRecord, type Genre, type Viewer } from "./types";

/* ---------------------------------------------------------------- helpers */

const GENRES: Genre[] = ["action", "sci-fi", "slice-of-life"];

type ComicOpts = {
	visibility?: ComicRecord["visibility"];
	status?: ComicRecord["status"];
	ownerId?: string;
	ownerName?: string;
	updatedAt?: Date;
	takenDownAt?: Date | null;
};

function comic(id: string, opts: ComicOpts = {}): ComicRecord {
	return {
		id,
		slug: `comic-${id}`,
		title: `Comic ${id}`,
		synopsis: `synopsis ${id}`,
		coverUrl: null,
		creatorId: opts.ownerId ?? "u-owner",
		creatorName: opts.ownerName ?? "Owner",
		genres: [GENRES[0] as Genre],
		chapterCount: 0,
		visibility: opts.visibility ?? "public",
		status: opts.status ?? "published",
		takenDownAt: opts.takenDownAt ?? null,
		updatedAt: opts.updatedAt ?? new Date("2026-01-01T00:00:00Z"),
	};
}

function makeReading() {
	const storage = createMemoryStorage();
	const data = createMemoryComicData();
	const reading = createReading({
		data,
		files: createStorageFilesPort(storage),
	});
	return { data, storage, reading };
}

const OWNER: Viewer = { kind: "user", id: "u-owner", role: "creator" };
const OTHER_CREATOR: Viewer = {
	kind: "user",
	id: "u-other-creator",
	role: "creator",
};
const READER: Viewer = { kind: "user", id: "u-reader", role: "reader" };
const ADMIN: Viewer = { kind: "user", id: "u-admin", role: "admin" };

const errorOf = async (fn: () => Promise<unknown>): Promise<string> => {
	try {
		await fn();
		return "NO_ERROR";
	} catch (error) {
		return (error as { code?: string }).code ?? "UNKNOWN";
	}
};

/* ------------------------------------------------------------------ seed */

// All 6 visibility × status combinations owned by u-owner, plus one public
// published comic owned by another creator — the full parity matrix.
function seedParity(data: ReturnType<typeof createMemoryComicData>) {
	const combos = [
		comic("c-pub-pub", { visibility: "public", status: "published" }),
		comic("c-pub-dra", { visibility: "public", status: "draft" }),
		comic("c-unl-pub", { visibility: "unlisted", status: "published" }),
		comic("c-unl-dra", { visibility: "unlisted", status: "draft" }),
		comic("c-pri-pub", { visibility: "private", status: "published" }),
		comic("c-pri-dra", { visibility: "private", status: "draft" }),
		comic("c-foreign", {
			visibility: "public",
			status: "published",
			ownerId: "u-foreign",
			ownerName: "Foreign",
		}),
	];
	data.seed.comics.push(...combos);
	// One chapter + one page per comic so page bytes exist everywhere.
	for (const c of combos) {
		data.seed.chapters.push({
			id: `ch-${c.id}`,
			comicId: c.id,
			ordinal: 1,
			title: "Ch 1",
			pageCount: 1,
		});
		data.seed.pages.push({
			id: `pg-${c.id}`,
			chapterId: `ch-${c.id}`,
			number: 1,
			storageKey: `${c.id}/1.jpg`,
			contentType: "image/jpeg",
			width: 800,
			height: 1200,
		});
	}
	return combos;
}

/* ----------------------------------------------------------------- tests */

describe("reading — interface tests (docs/design/reading-path.md)", () => {
	// Test 1 — the one that must never go red.
	describe("1. browse/canView parity across every viewer", () => {
		const viewers: [string, Viewer][] = [
			["anonymous", ANONYMOUS],
			["reader", READER],
			["owner", OWNER],
			["other creator", OTHER_CREATOR],
			["admin", ADMIN],
		];

		for (const [name, viewer] of viewers) {
			test(`browse returns exactly the browseVisible comics for ${name}; read agrees`, async () => {
				const { data, storage, reading } = makeReading();
				const comics = seedParity(data);
				for (const c of comics) {
					await storage.put(`${c.id}/1.jpg`, {
						bytes: new Uint8Array([1]),
						contentType: "image/jpeg",
					});
				}

				const result = await reading.browse(viewer);
				const expected = comics
					.filter((c) => browseVisible(viewer, c))
					.map((c) => c.id);
				expect(result.items.map((i) => i.id).sort()).toEqual(expected.sort());

				for (const c of comics) {
					const allowedByCanView = canView(viewer, c);
					if (allowedByCanView) {
						const read = await reading.read(viewer, {
							kind: "comic",
							ref: { id: c.id },
						});
						expect(read.kind).toBe("comic");
					} else {
						expect(
							await errorOf(() =>
								reading.read(viewer, { kind: "comic", ref: { id: c.id } }),
							),
						).toBe("NOT_FOUND");
					}
				}
			});
		}

		test("browse stays stable across pages (cursor)", async () => {
			const { data, reading } = makeReading();
			const comics = seedParity(data);
			for (const [i, c] of comics.entries()) {
				c.updatedAt = new Date(Date.UTC(2026, 0, i + 1));
			}
			const page1 = await reading.browse(ADMIN, { limit: 3 });
			expect(page1.items.map((c) => c.id)).toEqual([
				"c-foreign",
				"c-pri-dra",
				"c-pri-pub",
			]);
			expect(page1.nextCursor).not.toBeNull();
			const page2 = await reading.browse(ADMIN, {
				limit: 3,
				cursor: page1.nextCursor as string,
			});
			expect(page2.items.map((c) => c.id)).toEqual([
				"c-unl-dra",
				"c-unl-pub",
				"c-pub-dra",
			]);
			expect(page2.nextCursor).not.toBeNull();
			const page3 = await reading.browse(ADMIN, {
				limit: 3,
				cursor: page2.nextCursor as string,
			});
			expect(page3.items.map((c) => c.id)).toEqual(["c-pub-pub"]);
			expect(page3.nextCursor).toBeNull();
			const seen = new Set(
				[...page1.items, ...page2.items, ...page3.items].map((c) => c.id),
			);
			expect(seen.size).toBe(7);
		});
	});

	// Test 2
	describe("2. private and draft comics", () => {
		test("invisible to reader, visible to owner and admin — via read, shelf, page bytes", async () => {
			const { data, storage, reading } = makeReading();
			const priv = comic("c-secret", {
				visibility: "private",
				status: "published",
			});
			data.seed.comics.push(priv);
			data.seed.chapters.push({
				id: "ch-secret",
				comicId: "c-secret",
				ordinal: 1,
				title: "Ch",
				pageCount: 1,
			});
			data.seed.pages.push({
				id: "pg-secret",
				chapterId: "ch-secret",
				number: 1,
				storageKey: "secret/1.png",
				contentType: "image/png",
				width: 800,
				height: 1200,
			});
			await storage.put("secret/1.png", {
				bytes: new Uint8Array([9]),
				contentType: "image/png",
			});
			data.seed.saved.push({ userId: "u-owner", comicId: "c-secret" });
			data.seed.saved.push({ userId: "u-reader", comicId: "c-secret" });

			// read: hidden for reader, fine for owner/admin
			expect(
				await errorOf(() =>
					reading.read(READER, { kind: "comic", ref: { id: "c-secret" } }),
				),
			).toBe("NOT_FOUND");
			expect(
				(await reading.read(OWNER, { kind: "comic", ref: { id: "c-secret" } }))
					.kind,
			).toBe("comic");
			expect(
				(
					await reading.read(ADMIN, {
						kind: "comic",
						ref: { slug: "comic-c-secret" },
					})
				).kind,
			).toBe("comic");

			// shelf: a saved-but-unviewable comic drops out for the reader, stays for owner
			const readerShelf = await reading.shelf(READER);
			expect(readerShelf.saved.map((c) => c.id)).toEqual([]);
			const ownerShelf = await reading.shelf(OWNER);
			expect(ownerShelf.saved.map((c) => c.id)).toEqual(["c-secret"]);

			// page bytes
			expect(
				await errorOf(() =>
					reading.read(READER, { kind: "page", pageId: "pg-secret" }),
				),
			).toBe("NOT_FOUND");
			const page = await reading.read(OWNER, {
				kind: "page",
				pageId: "pg-secret",
			});
			expect(page.kind).toBe("page");

			// draft behaves the same
			const draft = comic("c-draft", { visibility: "public", status: "draft" });
			data.seed.comics.push(draft);
			expect(
				await errorOf(() =>
					reading.read(READER, { kind: "comic", ref: { id: "c-draft" } }),
				),
			).toBe("NOT_FOUND");
			expect(
				(await reading.read(OWNER, { kind: "comic", ref: { id: "c-draft" } }))
					.kind,
			).toBe("comic");
			expect((await reading.browse(ADMIN)).items.map((c) => c.id)).toContain(
				"c-draft",
			);
			expect((await reading.browse(OWNER)).items.map((c) => c.id)).toContain(
				"c-draft",
			);
			expect((await reading.browse(READER)).items.map((c) => c.id)).toEqual([]);
		});
	});

	// Test 3
	describe("3. page bytes unreachable by known pageId", () => {
		test("non-owner cannot fetch private page bytes even with the id", async () => {
			const { data, storage, reading } = makeReading();
			const priv = comic("c-priv", {
				visibility: "private",
				status: "published",
			});
			data.seed.comics.push(priv);
			data.seed.chapters.push({
				id: "ch-p",
				comicId: "c-priv",
				ordinal: 1,
				title: "Ch",
				pageCount: 1,
			});
			data.seed.pages.push({
				id: "pg-p",
				chapterId: "ch-p",
				number: 1,
				storageKey: "p/1.jpg",
				contentType: "image/jpeg",
				width: 800,
				height: 1200,
			});
			await storage.put("p/1.jpg", {
				bytes: new Uint8Array([0xff, 0xd8]),
				contentType: "image/jpeg",
			});

			expect(
				await errorOf(() =>
					reading.read(READER, { kind: "page", pageId: "pg-p" }),
				),
			).toBe("NOT_FOUND");
			expect(
				await errorOf(() =>
					reading.read(ANONYMOUS, { kind: "page", pageId: "pg-p" }),
				),
			).toBe("NOT_FOUND");
			expect(
				await errorOf(() =>
					reading.read(OTHER_CREATOR, { kind: "chapter", chapterId: "ch-p" }),
				),
			).toBe("NOT_FOUND");
			const ownerPage = await reading.read(OWNER, {
				kind: "page",
				pageId: "pg-p",
			});
			expect(ownerPage.kind === "page" && ownerPage.bytes.length).toBe(2);
		});
	});

	// Test 4
	describe("4. missing and hidden produce the same error", () => {
		test("identical error code and message shape", async () => {
			const { data, reading } = makeReading();
			const priv = comic("c-hidden", {
				visibility: "private",
				status: "published",
			});
			data.seed.comics.push(priv);

			const missing = await errorOf(() =>
				reading.read(READER, { kind: "comic", ref: { id: "does-not-exist" } }),
			);
			const hidden = await errorOf(() =>
				reading.read(READER, { kind: "comic", ref: { id: "c-hidden" } }),
			);
			expect(missing).toBe("NOT_FOUND");
			expect(hidden).toBe(missing);

			// slug lookups too
			const missingSlug = await errorOf(() =>
				reading.read(READER, { kind: "comic", ref: { slug: "nope" } }),
			);
			const hiddenSlug = await errorOf(() =>
				reading.read(READER, {
					kind: "comic",
					ref: { slug: "comic-c-hidden" },
				}),
			);
			expect(hiddenSlug).toBe(missingSlug);
		});
	});

	// Test 5
	describe("5. continue-reading drops comics that became invisible", () => {
		test("takedown/made-private entry disappears", async () => {
			const { data, reading } = makeReading();
			const pub = comic("c-read1", {
				visibility: "public",
				status: "published",
				updatedAt: new Date("2026-02-01"),
			});
			const later = comic("c-read2", {
				visibility: "public",
				status: "published",
				updatedAt: new Date("2026-02-02"),
			});
			data.seed.comics.push(pub, later);
			data.seed.chapters.push(
				{
					id: "ch-r1",
					comicId: "c-read1",
					ordinal: 1,
					title: "Ch",
					pageCount: 2,
				},
				{
					id: "ch-r2",
					comicId: "c-read2",
					ordinal: 1,
					title: "Ch",
					pageCount: 2,
				},
			);
			for (const ch of ["ch-r1", "ch-r2"]) {
				data.seed.pages.push(
					{
						id: `${ch}-p1`,
						chapterId: ch,
						number: 1,
						storageKey: `${ch}/1.jpg`,
						contentType: "image/jpeg",
						width: 700,
						height: 1000,
					},
					{
						id: `${ch}-p2`,
						chapterId: ch,
						number: 2,
						storageKey: `${ch}/2.jpg`,
						contentType: "image/jpeg",
						width: 700,
						height: 1000,
					},
				);
			}

			await reading.recordProgress(READER, "ch-r1", 2);
			await reading.recordProgress(READER, "ch-r2", 1);
			await reading.recordProgress(OWNER, "ch-r1", 2);
			await reading.recordProgress(OWNER, "ch-r2", 1);

			let shelf = await reading.shelf(READER);
			expect(shelf.continueReading.map((e) => e.comic.id)).toEqual([
				"c-read2",
				"c-read1",
			]);
			expect(shelf.continueReading[0]?.page).toBe(1);

			// takedown: c-read2 goes private → drops out, c-read1 remains
			later.visibility = "private";
			shelf = await reading.shelf(READER);
			expect(shelf.continueReading.map((e) => e.comic.id)).toEqual(["c-read1"]);

			// owner still sees both
			shelf = await reading.shelf(OWNER);
			expect(shelf.continueReading.map((e) => e.comic.id)).toEqual([
				"c-read2",
				"c-read1",
			]);
		});
	});

	// Test 6
	describe("6. recordProgress rules", () => {
		test("rejects anonymous, rejects unreachable comics, clamps pages", async () => {
			const { data, reading } = makeReading();
			const pub = comic("c-prog", {
				visibility: "public",
				status: "published",
			});
			const priv = comic("c-prog-priv", {
				visibility: "private",
				status: "published",
			});
			data.seed.comics.push(pub, priv);
			data.seed.chapters.push(
				{
					id: "ch-prog",
					comicId: "c-prog",
					ordinal: 1,
					title: "Ch",
					pageCount: 3,
				},
				{
					id: "ch-priv",
					comicId: "c-prog-priv",
					ordinal: 1,
					title: "Ch",
					pageCount: 3,
				},
			);
			for (const ch of ["ch-prog", "ch-priv"]) {
				for (let n = 1; n <= 3; n++) {
					data.seed.pages.push({
						id: `${ch}-${n}`,
						chapterId: ch,
						number: n,
						storageKey: `${ch}/${n}.jpg`,
						contentType: "image/jpeg",
						width: 700,
						height: 1000,
					});
				}
			}

			expect(
				await errorOf(() => reading.recordProgress(ANONYMOUS, "ch-prog", 1)),
			).toBe("UNAUTHENTICATED");
			expect(
				await errorOf(() => reading.recordProgress(READER, "ch-priv", 1)),
			).toBe("NOT_FOUND");
			expect(
				await errorOf(() =>
					reading.recordProgress(READER, "ch-nonexistent", 1),
				),
			).toBe("NOT_FOUND");

			await reading.recordProgress(READER, "ch-prog", 99);
			await reading.recordProgress(OWNER, "ch-prog", -5);
			await reading.recordProgress(ADMIN, "ch-prog", 2.7);

			const p = await data.getProgress("u-reader", "ch-prog");
			expect(p?.page).toBe(3);
			expect((await data.getProgress("u-owner", "ch-prog"))?.page).toBe(1);
			expect((await data.getProgress("u-admin", "ch-prog"))?.page).toBe(2);
		});
	});

	// PageSummary carries the stored dimensions so the reader can reserve layout.
	describe("6b. chapter read returns page dimensions", () => {
		test("PageSummary includes width and height", async () => {
			const { data, reading } = makeReading();
			data.seed.comics.push(
				comic("c-dims", { visibility: "public", status: "published" }),
			);
			data.seed.chapters.push({
				id: "ch-dims",
				comicId: "c-dims",
				ordinal: 1,
				title: "Ch",
				pageCount: 1,
			});
			data.seed.pages.push({
				id: "pg-dims",
				chapterId: "ch-dims",
				number: 1,
				storageKey: "dims/1.jpg",
				contentType: "image/jpeg",
				width: 900,
				height: 1350,
			});
			const result = await reading.read(ANONYMOUS, {
				kind: "chapter",
				chapterId: "ch-dims",
			});
			expect(result.kind).toBe("chapter");
			if (result.kind !== "chapter") return;
			expect(result.pages).toEqual([
				{ id: "pg-dims", number: 1, width: 900, height: 1350 },
			]);
		});
	});

	// 7. Takedown (social-admin.md invariant 3): invisible to everyone but
	// admin — including the owner — through the single canView decision.
	describe("7. taken-down comic", () => {
		test("browse, read, page bytes and shelf deny owner+reader+anon; admin still sees it", async () => {
			const { data, storage, reading } = makeReading();
			const down = comic("c-down", {
				visibility: "public",
				status: "published",
				takenDownAt: new Date("2026-02-01T00:00:00Z"),
			});
			data.seed.comics.push(down);
			data.seed.chapters.push({
				id: "ch-down",
				comicId: "c-down",
				ordinal: 1,
				title: "Ch",
				pageCount: 1,
			});
			data.seed.pages.push({
				id: "pg-down",
				chapterId: "ch-down",
				number: 1,
				storageKey: "down/1.jpg",
				contentType: "image/jpeg",
				width: 800,
				height: 1200,
			});
			await storage.put("down/1.jpg", {
				bytes: new Uint8Array([5]),
				contentType: "image/jpeg",
			});
			data.seed.saved.push({ userId: "u-owner", comicId: "c-down" });

			expect(canView(OWNER, down)).toBe(false);
			expect(canView(READER, down)).toBe(false);
			expect(canView(ANONYMOUS, down)).toBe(false);
			expect(canView(ADMIN, down)).toBe(true);

			for (const viewer of [ANONYMOUS, READER, OWNER]) {
				const browse = await reading.browse(viewer, { limit: 100 });
				expect(browse.items.map((i) => i.id)).not.toContain("c-down");
				expect(
					await errorOf(() =>
						reading.read(viewer, { kind: "comic", ref: { id: "c-down" } }),
					),
				).toBe("NOT_FOUND");
				expect(
					await errorOf(() =>
						reading.read(viewer, { kind: "page", pageId: "pg-down" }),
					),
				).toBe("NOT_FOUND");
			}
			// even the owner's shelf drops it
			const shelf = await reading.shelf(OWNER);
			expect(shelf.saved.map((c) => c.id)).not.toContain("c-down");

			// admin path still works — the takedown is visible, not vanished
			const asAdmin = await reading.read(ADMIN, {
				kind: "comic",
				ref: { id: "c-down" },
			});
			expect(asAdmin.kind).toBe("comic");
			expect(
				await reading.read(ADMIN, { kind: "page", pageId: "pg-down" }),
			).toMatchObject({ kind: "page" });
		});

		test("untakedown (takenDownAt cleared) restores access", async () => {
			const { data, reading } = makeReading();
			const down = comic("c-restored", { takenDownAt: new Date() });
			data.seed.comics.push(down);
			expect(
				await errorOf(() =>
					reading.read(READER, { kind: "comic", ref: { id: "c-restored" } }),
				),
			).toBe("NOT_FOUND");
			down.takenDownAt = null;
			const ok = await reading.read(READER, {
				kind: "comic",
				ref: { id: "c-restored" },
			});
			expect(ok.kind).toBe("comic");
		});
	});

	describe("8. shelf save/unsave/isSaved", () => {
		test("save/unsave/isSaved round trip", async () => {
			const { data, reading } = makeReading();
			data.seed.comics.push(comic("c-pub"));
			expect(await reading.isSaved(READER, "c-pub")).toBe(false);
			await reading.saveComic(READER, "c-pub");
			expect(await reading.isSaved(READER, "c-pub")).toBe(true);
			expect(data.seed.saved).toEqual([
				{ userId: "u-reader", comicId: "c-pub" },
			]);
			await reading.unsaveComic(READER, "c-pub");
			expect(await reading.isSaved(READER, "c-pub")).toBe(false);
			expect(data.seed.saved.length).toBe(0);
		});

		test("save is idempotent; unsave on unsaved is a no-op", async () => {
			const { data, reading } = makeReading();
			data.seed.comics.push(comic("c-pub"));
			await reading.saveComic(READER, "c-pub");
			await reading.saveComic(READER, "c-pub");
			expect(data.seed.saved.length).toBe(1);
			expect(await reading.isSaved(READER, "c-pub")).toBe(true);
			await reading.unsaveComic(READER, "c-pub");
			await reading.unsaveComic(READER, "c-pub");
			expect(data.seed.saved.length).toBe(0);
		});

		test("anonymous save/unsave → UNAUTHENTICATED; isSaved → false", async () => {
			const { data, reading } = makeReading();
			data.seed.comics.push(comic("c-pub"));
			expect(await errorOf(() => reading.saveComic(ANONYMOUS, "c-pub"))).toBe(
				"UNAUTHENTICATED",
			);
			expect(await errorOf(() => reading.unsaveComic(ANONYMOUS, "c-pub"))).toBe(
				"UNAUTHENTICATED",
			);
			expect(await reading.isSaved(ANONYMOUS, "c-pub")).toBe(false);
			expect(await reading.isSaved(ANONYMOUS, "does-not-exist")).toBe(false);
		});

		test("inaccessible comic → NOT_FOUND on write, false on read", async () => {
			const { data, reading } = makeReading();
			data.seed.comics.push(
				comic("c-priv", { visibility: "private", status: "published" }),
			);
			// READER cannot see a private comic owned by u-owner; owner can.
			expect(await errorOf(() => reading.saveComic(READER, "c-priv"))).toBe(
				"NOT_FOUND",
			);
			expect(await errorOf(() => reading.unsaveComic(READER, "c-priv"))).toBe(
				"NOT_FOUND",
			);
			expect(await reading.isSaved(READER, "c-priv")).toBe(false);
			expect(
				await errorOf(() => reading.saveComic(READER, "does-not-exist")),
			).toBe("NOT_FOUND");
			await reading.saveComic(OWNER, "c-priv");
			expect(await reading.isSaved(OWNER, "c-priv")).toBe(true);
		});

		test("shelf and isSaved agree, including after takedown hides a saved comic", async () => {
			const { data, reading } = makeReading();
			const target = comic("c-pub");
			data.seed.comics.push(target, comic("c-other-pub"));
			await reading.saveComic(READER, "c-pub");
			await reading.saveComic(READER, "c-other-pub");
			let shelf = await reading.shelf(READER);
			expect(shelf.saved.map((c) => c.id).sort()).toEqual([
				"c-other-pub",
				"c-pub",
			]);
			expect(await reading.isSaved(READER, "c-pub")).toBe(true);
			expect(await reading.isSaved(READER, "c-other-pub")).toBe(true);
			expect(await reading.isSaved(READER, "c-never")).toBe(false);
			// Takedown hides it from the shelf → isSaved must flip to false too.
			target.takenDownAt = new Date();
			shelf = await reading.shelf(READER);
			expect(shelf.saved.map((c) => c.id)).toEqual(["c-other-pub"]);
			expect(await reading.isSaved(READER, "c-pub")).toBe(false);
		});
	});
});
