import { describe, expect, test } from "bun:test";
import { ANONYMOUS, type ComicRecord, type Viewer } from "@comic/reading";
import { createMemoryComicData } from "@comic/reading/adapters/memory";
import { createMemorySocialData } from "./adapters/memory";
import { createSocial } from "./index";
import { MAX_COMMENT_BODY, type ReportReason } from "./types";

/* ---------------------------------------------------------------- fixtures */

const OWNER: Viewer = { kind: "user", id: "u-owner", role: "creator" };
const ADMIN: Viewer = { kind: "user", id: "u-admin", role: "admin" };
const READER: Viewer = { kind: "user", id: "u-reader", role: "reader" };
const OTHER: Viewer = { kind: "user", id: "u-other", role: "reader" };

function comic(id: string, over: Partial<ComicRecord> = {}): ComicRecord {
	return {
		id,
		slug: `comic-${id}`,
		title: `Comic ${id}`,
		synopsis: null,
		coverUrl: null,
		creatorId: "u-owner",
		creatorName: "Owner",
		genres: [],
		chapterCount: 0,
		visibility: "public",
		status: "published",
		takenDownAt: null,
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...over,
	};
}

function setup() {
	const comics = createMemoryComicData();
	comics.seed.comics.push(
		comic("c-public"),
		comic("c-private", { visibility: "private", status: "published" }),
	);
	const data = createMemorySocialData({
		users: [
			{ id: "u-owner", name: "Owner", role: "creator" },
			{ id: "u-admin", name: "Admin", role: "admin" },
			{ id: "u-reader", name: "Reader", role: "reader" },
			{ id: "u-other", name: "Other", role: "reader" },
		],
	});
	const social = createSocial({ data, comics });
	return { data, comics, social };
}

const errorOf = async (fn: () => Promise<unknown>): Promise<string> => {
	try {
		await fn();
		return "NO_ERROR";
	} catch (error) {
		return (error as { code?: string }).code ?? "UNKNOWN";
	}
};

/* ------------------------------------------------------------------ tests */

describe("social — interface tests (docs/design/social-admin.md)", () => {
	// Test 1
	test("comment on a readable comic works; on an invisible one → NOT_FOUND", async () => {
		const { social } = setup();
		const made = await social.comment(READER, {
			comicId: "c-public",
			body: "great page 4",
		});
		expect(made.body).toBe("great page 4");
		expect(made.author.id).toBe("u-reader");
		expect(
			await errorOf(() =>
				social.comment(READER, { comicId: "c-private", body: "hi" }),
			),
		).toBe("NOT_FOUND");
		expect(
			await errorOf(() =>
				social.comment(OWNER, { comicId: "c-private", body: "mine" }),
			),
		).toBe("NO_ERROR");
	});

	// Test 2a — ruling 2026-09-14: comment READS are public; WRITES stay signed-in.
	test("anonymous listComments works on a public comic; private → NOT_FOUND; hidden stays invisible", async () => {
		const { social, data } = setup();
		const posted = await social.comment(READER, {
			comicId: "c-public",
			body: "readable by anon",
		});
		const hidden = await social.comment(OTHER, {
			comicId: "c-public",
			body: "moderated",
		});
		data.comments.find((c) => c.id === hidden.id)!.hiddenAt = new Date();

		const asAnon = await social.listComments(ANONYMOUS, {
			comicId: "c-public",
		});
		expect(asAnon.items.map((i) => i.id)).toContain(posted.id);
		expect(asAnon.items.map((i) => i.id)).not.toContain(hidden.id);
		expect(asAnon.count).toBe(1); // hidden excluded for everyone but admin

		expect(
			await errorOf(() =>
				social.listComments(ANONYMOUS, { comicId: "c-private" }),
			),
		).toBe("NOT_FOUND");
		// A comment on a private comic must not leak even when the reader is
		// the one listing: the hiding rule is the comic's, not the comment's.
		await social.comment(OWNER, { comicId: "c-private", body: "hidden room" });
		// Writes stay signed-in: anonymous comment → UNAUTHENTICATED (test 2),
		// asserted there. Here: anonymous may not flip anything either.
		expect(
			await errorOf(() =>
				social.comment(ANONYMOUS, { comicId: "c-public", body: "x" }),
			),
		).toBe("UNAUTHENTICATED");
	});

	// Test 2
	test("anonymous comment/rate/follow/report → UNAUTHENTICATED", async () => {
		const { social } = setup();
		expect(
			await errorOf(() =>
				social.comment(ANONYMOUS, { comicId: "c-public", body: "x" }),
			),
		).toBe("UNAUTHENTICATED");
		expect(
			await errorOf(() =>
				social.rate(ANONYMOUS, { comicId: "c-public", value: 5 }),
			),
		).toBe("UNAUTHENTICATED");
		expect(
			await errorOf(() => social.follow(ANONYMOUS, { creatorId: "u-owner" })),
		).toBe("UNAUTHENTICATED");
		expect(
			await errorOf(() =>
				social.report(ANONYMOUS, {
					targetType: "comic",
					targetId: "c-public",
					reason: "spam" satisfies ReportReason,
				}),
			),
		).toBe("UNAUTHENTICATED");
		// listComments moved to public reads (ruling 2026-09-14) — see test 2a.
	});

	// Test 3
	test("hidden comment disappears from listing + count for non-admin, stays for admin", async () => {
		const { social, data, comics } = setup();
		const a = await social.comment(READER, {
			comicId: "c-public",
			body: "fine",
		});
		await social.comment(OTHER, { comicId: "c-public", body: "not fine" });
		// hide via the data store the same way resolveReport's transaction does
		const stored = data.comments.find((c) => c.id === a.id);
		stored!.hiddenAt = new Date();

		const asReader = await social.listComments(READER, { comicId: "c-public" });
		expect(asReader.items.map((i) => i.id)).not.toContain(a.id);
		expect(asReader.count).toBe(1);

		const asAdmin = await social.listComments(ADMIN, { comicId: "c-public" });
		expect(asAdmin.items.map((i) => i.id)).toContain(a.id);
		expect(asAdmin.count).toBe(2);
		void comics;
	});

	// Test 4
	test("delete: author yes, third party FORBIDDEN, admin any", async () => {
		const { social, data } = setup();
		const mine = await social.comment(READER, {
			comicId: "c-public",
			body: "mine",
		});
		expect(await errorOf(() => social.deleteComment(OTHER, mine.id))).toBe(
			"FORBIDDEN",
		);
		// admin deletes a comment they did not write
		const other = await social.comment(OTHER, {
			comicId: "c-public",
			body: "spam",
		});
		await social.deleteComment(ADMIN, other.id);
		expect(data.comments.some((c) => c.id === other.id)).toBe(false);
		await social.deleteComment(READER, mine.id);
		expect(data.comments.some((c) => c.id === mine.id)).toBe(false);
	});

	// Test 5
	test("rating upsert moves the summary; 0 and 6 → INVALID_INPUT", async () => {
		const { social } = setup();
		const first = await social.rate(READER, { comicId: "c-public", value: 2 });
		expect(first).toEqual({ average: 2, count: 1, userValue: 2 });
		const second = await social.rate(READER, { comicId: "c-public", value: 5 });
		expect(second).toEqual({ average: 5, count: 1, userValue: 5 });
		await social.rate(OTHER, { comicId: "c-public", value: 3 });
		const agg = await social.ratingSummary(OTHER, "c-public");
		expect(agg).toEqual({ average: 4, count: 2, userValue: 3 });
		expect(
			await errorOf(() =>
				social.rate(READER, { comicId: "c-public", value: 0 }),
			),
		).toBe("INVALID_INPUT");
		expect(
			await errorOf(() =>
				social.rate(READER, { comicId: "c-public", value: 6 }),
			),
		).toBe("INVALID_INPUT");
		expect(
			await errorOf(() =>
				social.rate(READER, { comicId: "c-public", value: 4.5 }),
			),
		).toBe("INVALID_INPUT");
	});

	// Test 6
	test("follow / unfollow / re-follow; self-follow and follow-a-reader rejected", async () => {
		const { social, data } = setup();
		await social.follow(READER, { creatorId: "u-owner" });
		expect(data.follows).toEqual([
			{ followerId: "u-reader", creatorId: "u-owner" },
		]);
		expect(
			await errorOf(() => social.follow(READER, { creatorId: "u-owner" })),
		).toBe("CONFLICT");
		await social.unfollow(READER, { creatorId: "u-owner" });
		expect(data.follows.length).toBe(0);
		await social.follow(READER, { creatorId: "u-owner" });
		expect(data.follows.length).toBe(1);
		expect(
			await errorOf(() => social.follow(READER, { creatorId: "u-reader" })),
		).toBe("INVALID_INPUT");
		expect(
			await errorOf(() => social.follow(READER, { creatorId: "u-other" })),
		).toBe("INVALID_INPUT"); // a reader
	});

	// Test 7
	test("duplicate open report → CONFLICT; report on invisible comic → NOT_FOUND", async () => {
		const { social, data } = setup();
		await social.report(READER, {
			targetType: "comic",
			targetId: "c-public",
			reason: "spam",
			note: "  ",
		});
		expect(data.reports[0]?.note).toBeNull();
		expect(
			await errorOf(() =>
				social.report(READER, {
					targetType: "comic",
					targetId: "c-public",
					reason: "harassment",
				}),
			),
		).toBe("CONFLICT");
		// another reporter is fine
		await social.report(OTHER, {
			targetType: "comic",
			targetId: "c-public",
			reason: "spam",
		});
		expect(
			await errorOf(() =>
				social.report(READER, {
					targetType: "comic",
					targetId: "c-private",
					reason: "spam",
				}),
			),
		).toBe("NOT_FOUND");
		const made = await social.comment(READER, {
			comicId: "c-public",
			body: "b",
		});
		await social.report(OTHER, {
			targetType: "comment",
			targetId: made.id,
			reason: "spam",
		});
		expect(
			await errorOf(() =>
				social.report(READER, {
					targetType: "comment",
					targetId: "nope",
					reason: "spam",
				}),
			),
		).toBe("NOT_FOUND");
	});

	// Test 11 (body-length guard belongs here)
	test("empty body and oversize body → INVALID_INPUT", async () => {
		const { social } = setup();
		expect(
			await errorOf(() =>
				social.comment(READER, { comicId: "c-public", body: "   " }),
			),
		).toBe("INVALID_INPUT");
		expect(
			await errorOf(() =>
				social.comment(READER, {
					comicId: "c-public",
					body: "x".repeat(MAX_COMMENT_BODY + 1),
				}),
			),
		).toBe("INVALID_INPUT");
	});

	// Test 12: isFollowing — the read path follow state was missing.
	test("isFollowing: true after follow, false after unfollow, false unsaved", async () => {
		const { social } = setup();
		expect(await social.isFollowing(READER, "u-owner")).toBe(false);
		await social.follow(READER, { creatorId: "u-owner" });
		expect(await social.isFollowing(READER, "u-owner")).toBe(true);
		await social.unfollow(READER, { creatorId: "u-owner" });
		expect(await social.isFollowing(READER, "u-owner")).toBe(false);
		// another user's follow does not leak into this viewer's answer
		await social.follow(OWNER, { creatorId: "u-admin" });
		expect(await social.isFollowing(READER, "u-admin")).toBe(false);
	});

	test("isFollowing: anonymous → false, unknown creatorId → false (no leak)", async () => {
		const { social } = setup();
		await social.follow(READER, { creatorId: "u-owner" });
		expect(await social.isFollowing(ANONYMOUS, "u-owner")).toBe(false);
		expect(await social.isFollowing(READER, "u-nope")).toBe(false);
		// self-follow is false, not an error, even though follow() rejects it
		expect(await social.isFollowing(READER, "u-reader")).toBe(false);
	});
});
