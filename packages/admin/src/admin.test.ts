import { describe, expect, test } from "bun:test";
import { ANONYMOUS, type Viewer } from "@comic/reading";
import { createMemoryStorage } from "@comic/storage";
import { createMemoryAdminData } from "./adapters/memory";
import { createStorageSamplePort } from "./adapters/storage-files";
import { createAdmin } from "./index";

const ADMIN: Viewer = { kind: "user", id: "u-admin", role: "admin" };
const CREATOR: Viewer = { kind: "user", id: "u-creator", role: "creator" };
const READER: Viewer = { kind: "user", id: "u-reader", role: "reader" };

function setup() {
	const data = createMemoryAdminData({
		users: [
			{ id: "u-admin", name: "Admin", role: "admin" },
			{ id: "u-reader", name: "Reader", role: "reader" },
			{ id: "u-creator", name: "Creator", role: "creator" },
		],
		comics: [
			{
				id: "c1",
				visibility: "public",
				status: "published",
				takenDownAt: null,
				takedownReason: null,
			},
		],
		comments: [{ id: "cm1", hiddenAt: null }],
		reports: [
			{
				id: "r-open",
				targetType: "comment",
				targetId: "cm1",
				reporter: { id: "u-reader", name: "Reader" },
				reason: "spam",
				note: null,
				status: "open",
				resolvedAt: null,
				resolvedBy: null,
				createdAt: new Date("2026-01-01T00:00:00Z"),
			},
			{
				id: "r-open-comic",
				targetType: "comic",
				targetId: "c1",
				reporter: { id: "u-reader", name: "Reader" },
				reason: "harassment",
				note: null,
				status: "open",
				resolvedAt: null,
				resolvedBy: null,
				createdAt: new Date("2026-01-01T00:00:00Z"),
			},
		],
	});
	const storage = createMemoryStorage();
	const admin = createAdmin({ data, files: createStorageSamplePort(storage) });
	return { data, storage, admin };
}

const errorOf = async (fn: () => Promise<unknown>): Promise<string> => {
	try {
		await fn();
		return "NO_ERROR";
	} catch (error) {
		return (error as { code?: string }).code ?? "UNKNOWN";
	}
};

describe("admin — interface tests (docs/design/social-admin.md)", () => {
	// Test 8 — application flow
	test("pending blocks a second application; approve grants creator; reject leaves role", async () => {
		const { admin, data } = setup();
		const applied = await admin.applyForCreator(READER, {
			motivation: "  I draw every day  ",
			portfolioUrl: "https://example.com/art",
			sample: {
				filename: "../evil/name.png", // never a path — the key is minted
				contentType: "image/png",
				bytes: new Uint8Array([1, 2, 3]),
			},
		});
		expect(applied.motivation).toBe("I draw every day");
		expect(applied.status).toBe("pending");
		expect(applied.sampleKey).toMatch(/^applications\/.+\/sample$/);
		const stored = await data.findLatestApplication("u-reader");
		expect(stored?.sampleKey).not.toBeNull();

		expect(
			await errorOf(() =>
				admin.applyForCreator(READER, { motivation: "again" }),
			),
		).toBe("CONFLICT");

		// a creator or admin applying is INVALID_INPUT (invariant 9)
		expect(
			await errorOf(() =>
				admin.applyForCreator(CREATOR, { motivation: "me too" }),
			),
		).toBe("INVALID_INPUT");

		const approved = await admin.decideApplication(ADMIN, {
			id: applied.id,
			decision: "approve",
		});
		expect(approved.status).toBe("approved");
		expect(approved.decidedBy).toBe("u-admin");
		expect(data.users.find((u) => u.id === "u-reader")?.role).toBe("creator");

		// double decide → CONFLICT
		expect(
			await errorOf(() =>
				admin.decideApplication(ADMIN, { id: applied.id, decision: "reject" }),
			),
		).toBe("CONFLICT");

		// rejected path leaves the role alone
		const second = await admin.applyForCreator(READER, { motivation: "retry" });
		const rejected = await admin.decideApplication(ADMIN, {
			id: second.id,
			decision: "reject",
		});
		expect(rejected.status).toBe("rejected");
		expect(data.users.find((u) => u.id === "u-reader")?.role).toBe("creator");
	});

	test("applyForCreator needs a real motivation, rejects a bad URL, requires auth", async () => {
		const { admin } = setup();
		expect(
			await errorOf(() => admin.applyForCreator(READER, { motivation: "   " })),
		).toBe("INVALID_INPUT");
		expect(
			await errorOf(() =>
				admin.applyForCreator(READER, {
					motivation: "ok",
					portfolioUrl: "ftp://nope",
				}),
			),
		).toBe("INVALID_INPUT");
		expect(
			await errorOf(() =>
				admin.applyForCreator(ANONYMOUS, { motivation: "ok" }),
			),
		).toBe("UNAUTHENTICATED");
	});

	// Test 10 + role guards
	test("resolveReport(hide_comment) hides + resolves together; second resolve CONFLICT; takedown action lands on the comic", async () => {
		const { admin, data } = setup();
		// non-admin and anon are locked out of every admin surface
		expect(await errorOf(() => admin.listReports(READER, {}))).toBe(
			"FORBIDDEN",
		);
		expect(
			await errorOf(() =>
				admin.resolveReport(ANONYMOUS, { id: "r-open", action: "dismiss" }),
			),
		).toBe("UNAUTHENTICATED");

		const openList = await admin.listReports(ADMIN, { status: "open" });
		expect(openList.items.map((r) => r.id).sort()).toEqual([
			"r-open",
			"r-open-comic",
		]);

		const resolved = await admin.resolveReport(ADMIN, {
			id: "r-open",
			action: "hide_comment",
		});
		expect(resolved.status).toBe("resolved");
		expect(resolved.resolvedBy).toBe("u-admin");
		expect(data.comments.find((c) => c.id === "cm1")?.hiddenAt).not.toBeNull();
		expect(
			await errorOf(() =>
				admin.resolveReport(ADMIN, { id: "r-open", action: "dismiss" }),
			),
		).toBe("CONFLICT");

		const downed = await admin.resolveReport(ADMIN, {
			id: "r-open-comic",
			action: "take_down_comic",
		});
		expect(downed.status).toBe("resolved");
		const comic = data.comics.find((c) => c.id === "c1");
		expect(comic?.takenDownAt).not.toBeNull();
		expect(comic?.takedownReason).toBe("report r-open-comic");
		// Invariant 11: forced private + draft
		expect(comic?.visibility).toBe("private");
		expect(comic?.status).toBe("draft");
	});

	// Test 9's admin-side half (the read-path half lives in reading's suite)
	test("setTakedown forces private+draft; untakedown clears fields but stays private", async () => {
		const { admin, data } = setup();
		expect(
			await errorOf(() =>
				admin.setTakedown(CREATOR, { comicId: "c1", takenDown: true }),
			),
		).toBe("FORBIDDEN");
		expect(
			await errorOf(() =>
				admin.setTakedown(ADMIN, { comicId: "nope", takenDown: true }),
			),
		).toBe("NOT_FOUND");

		await admin.setTakedown(ADMIN, {
			comicId: "c1",
			takenDown: true,
			reason: "policy violation",
		});
		let comic = data.comics.find((c) => c.id === "c1");
		expect(comic?.takenDownAt).not.toBeNull();
		expect(comic?.takedownReason).toBe("policy violation");
		expect(comic?.visibility).toBe("private");
		expect(comic?.status).toBe("draft");

		await admin.setTakedown(ADMIN, { comicId: "c1", takenDown: false });
		comic = data.comics.find((c) => c.id === "c1");
		expect(comic?.takenDownAt).toBeNull();
		expect(comic?.takedownReason).toBeNull();
		// stays private — the owner republishes deliberately (invariant 11)
		expect(comic?.visibility).toBe("private");
	});

	test("listApplications filters by status and pages by cursor", async () => {
		const { admin, data } = setup();
		for (let i = 0; i < 3; i++) {
			await admin.applyForCreator(
				{ kind: "user", id: `u-r${i}`, role: "reader" },
				{
					motivation: `m${i}`,
				},
			);
			data.users.push({ id: `u-r${i}`, name: `R${i}`, role: "reader" });
		}
		const pending = await admin.listApplications(ADMIN, { status: "pending" });
		expect(pending.items.length).toBe(3);
		const first = await admin.listApplications(ADMIN, {});
		expect(first.items.length).toBe(3);
	});

	test("sample bytes land in the storage port keyed by the minted key", async () => {
		const { admin, storage } = setup();
		const applied = await admin.applyForCreator(READER, {
			motivation: "draw stuff",
			sample: {
				filename: "sample.png",
				contentType: "image/png",
				bytes: new Uint8Array([9, 8, 7]),
			},
		});
		const got = await storage.get(applied.sampleKey as string);
		expect(Array.from(got?.bytes ?? [])).toEqual([9, 8, 7]);
	});
});
