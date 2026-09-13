/**
 * E2E smoke for the social + admin chain (H1): creator application → admin
 * approval → real chapter ingest → reader comments/rates/follows → comment
 * report → admin hides it → admin takes the comic down → gone from anon
 * browse and the owner's read fails → untakedown restores the owner only.
 * Boots the real Hono app + real Postgres. Run from apps/server/:
 *   bun e2e-social.ts
 */
import { createPrismaClient } from "@comic/db";
import { zipSync } from "fflate";
import { env } from "./src/env.server";
import { app } from "./src/index";
import { auth } from "./src/services";

const db = createPrismaClient(env);

const assert = (cond: unknown, msg: string): void => {
	if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
	console.log(`ok — ${msg}`);
};

/* ---------------------------------------------------------------- helpers */

const rpcFor = (cookie: string) => async (path: string, input: unknown) => {
	const res = await app.request(`http://localhost/rpc${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", cookie },
		body: JSON.stringify({ json: input }),
	});
	const text = await res.text();
	let payload: unknown;
	try {
		const parsed = JSON.parse(text) as { json?: unknown };
		payload = "json" in parsed ? parsed.json : parsed;
	} catch {
		payload = undefined;
	}
	return { status: res.status, data: payload, text };
};

const signUp = async (
	name: string,
): Promise<{ cookie: string; id: string }> => {
	const email = `e2e-soc-${name.toLowerCase().replace(/ /g, "-")}-${Date.now()}@example.com`;
	const res = await auth.handler(
		new Request("http://localhost/api/auth/sign-up/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password: "e2e-password-123", name }),
		}),
	);
	const cookie: string = res.headers.get("set-cookie") ?? "";
	if (!cookie) throw new Error(`no session cookie from sign-up ${name}`);
	const user = await db.user.findUniqueOrThrow({ where: { email } });
	return { cookie, id: user.id };
};

const session = async (name: string) => {
	const { cookie, id } = await signUp(name);
	return { cookie, id, rpc: rpcFor(cookie) };
};

const data = <T>(r: { data: unknown }): T => r.data as T;

/* ------------------------------------------------------------------ setup */

// Clean slate for repeated runs (the chain's rows stay identifiable).
await db.comic.deleteMany({ where: { title: "E2E Social Comic" } });
await db.user.deleteMany({
	where: { name: { in: ["E2E Applicant", "E2E Admin", "E2E Reader"] } },
});

const admin = await session("E2E Admin");
await db.user.update({ where: { id: admin.id }, data: { role: "admin" } });
// The applicant starts as a plain reader; a SECOND reader does the social acts.
const creator = await session("E2E Applicant");
const reader = await session("E2E Reader");
const anonRpc = rpcFor("");
console.log("sessions: admin + applicant + reader ready");

/* 1. apply for creator */
const applyRes = await creator.rpc("/admin/applyForCreator", {
	motivation: "I draw every day — approve me",
});
const application = data<{ id: string; status: string }>(applyRes);
assert(
	applyRes.status === 200 && application.status === "pending",
	`applyForCreator → pending application (${application.id})`,
);

/* 2. non-admin blocked; admin lists + approves; role flips atomically */
const listForbidden = await creator.rpc("/admin/listApplications", {});
assert(
	listForbidden.status === 403,
	"non-admin calling listApplications → 403 (router role guard)",
);
const listPending = await admin.rpc("/admin/listApplications", {
	status: "pending",
});
const pendingItems = data<{ items: { id: string }[] }>(listPending).items;
assert(
	pendingItems.some((a) => a.id === application.id),
	"admin listApplications(pending) contains the application",
);
const decide = await admin.rpc("/admin/decideApplication", {
	id: application.id,
	decision: "approve",
});
assert(
	data<{ status: string }>(decide).status === "approved",
	"decideApplication approve → approved",
);
const applicantRow = await db.user.findUniqueOrThrow({
	where: { id: creator.id },
});
assert(
	applicantRow.role === "creator",
	"approve granted the creator role in the same transaction",
);
const decidedAgain = await admin.rpc("/admin/decideApplication", {
	id: application.id,
	decision: "reject",
});
assert(
	decidedAgain.status === 409,
	"a second decide on the same application → 409 CONFLICT",
);

/* 3. the new creator uploads a real chapter (CBZ through the multipart route) */
const createComic = await creator.rpc("/publishing/createComic", {
	title: "E2E Social Comic",
});
const comic = data<{ id: string; slug: string }>(createComic);
assert(createComic.status === 200 && !!comic.id, `createComic → ${comic.slug}`);

/** Real decodable 3×2 PNG with a unique tail byte for order proofing. */
const pngWith = (seed: number): Uint8Array => {
	const b = new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
		0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x02,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x25, 0x1c, 0xfe, 0x5f, 0x00, 0x00, 0x00,
		0x0f, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x60, 0x18, 0x75, 0x84,
		0x6a, 0x40, 0x09, 0x3c, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
		0x44, 0xae, 0x42, 0x60, 0x82,
	]);
	b[b.length - 12] = seed;
	return b;
};
const form = new FormData();
form.set("comicId", comic.id);
form.set(
	"archive",
	new File(
		[zipSync({ "p1.png": pngWith(11), "p2.png": pngWith(22) })],
		"chapter.cbz",
		{ type: "application/vnd.comicbook+zip" },
	),
);
const upRes = await app.request("/publish/chapters", {
	method: "POST",
	headers: { cookie: creator.cookie },
	body: form,
});
const chapter = (await upRes.json()) as { id: string; pageCount: number };
assert(
	upRes.status === 201 && chapter.pageCount === 2,
	"creator (approved, not hand-promoted) ingested a 2-page chapter",
);
const pages = await db.page.findMany({
	where: { chapterId: chapter.id },
	orderBy: { number: "asc" },
});
assert(
	pages.length === 2 &&
		pages[0]?.width === 3 &&
		pages[0]?.height === 2 &&
		pages[1]?.width === 3 &&
		pages[1]?.height === 2,
	`ingest stored real dimensions (3x2) on both Page rows (${pages[0]?.width}x${pages[0]?.height})`,
);

/* publish it so a reader may see it at all */
await db.comic.update({
	where: { id: comic.id },
	data: { visibility: "public", status: "published" },
});

/* 4. a reader comments, rates and follows */
const commented = await reader.rpc("/social/comment", {
	comicId: comic.id,
	body: "the panel layout on page 2 slaps",
});
const comment = data<{ id: string; author: { name: string } }>(commented);
assert(
	commented.status === 200 && !!comment.id,
	`reader commented as ${comment.author.name}`,
);
const rated = await reader.rpc("/social/rate", { comicId: comic.id, value: 5 });
const summary = data<{ average: number; count: number; userValue: number }>(
	rated,
);
assert(
	summary.average === 5 && summary.count === 1 && summary.userValue === 5,
	"rate 5 → summary average 5, count 1",
);
const badRating = await reader.rpc("/social/rate", {
	comicId: comic.id,
	value: 6,
});
assert(badRating.status === 400, "rating a 6 → 400 INVALID_INPUT");
const followed = await reader.rpc("/social/follow", { creatorId: creator.id });
assert(followed.status === 200, "reader follows the creator → 200");
const selfFollow = await reader.rpc("/social/follow", { creatorId: reader.id });
assert(selfFollow.status === 400, "self-follow → 400 INVALID_INPUT");
await reader.rpc("/social/comment", {
	comicId: comic.id,
	body: "second comment, reportable",
});
const listed = await reader.rpc("/social/listComments", { comicId: comic.id });
const comments = data<{ items: { id: string; body: string }[] }>(listed).items;
assert(comments.length === 2, "listComments returns both comments");
const reportable = comments.find(
	(c) => c.body === "second comment, reportable",
)!;

/* 5. report the comment → admin hides it */
const reported = await reader.rpc("/social/report", {
	targetType: "comment",
	targetId: reportable.id,
	reason: "spam",
	note: "second comment is filler",
});
assert(reported.status === 200, "reader reported the comment");
const dupReport = await reader.rpc("/social/report", {
	targetType: "comment",
	targetId: reportable.id,
	reason: "spam",
});
assert(dupReport.status === 409, "a second open report → 409 CONFLICT");
const openReports = await admin.rpc("/admin/listReports", { status: "open" });
const reportRow = data<{ items: { id: string; targetId: string }[] }>(
	openReports,
).items.find((r) => r.targetId === reportable.id)!;
assert(!!reportRow, "the report shows up in the admin's open queue");
const hidden = await admin.rpc("/admin/resolveReport", {
	id: reportRow.id,
	action: "hide_comment",
});
assert(
	data<{ status: string }>(hidden).status === "resolved",
	"resolveReport(hide_comment) → resolved",
);
const afterHide = await reader.rpc("/social/listComments", {
	comicId: comic.id,
});
const visible = data<{ items: { id: string }[]; count: number }>(afterHide);
assert(
	visible.items.length === 1 && visible.items[0]?.id !== reportable.id,
	"the hidden comment is gone from the listing for everyone but admin",
);
assert(visible.count === 1, "the comment count excludes the hidden one");
const adminListing = await admin.rpc("/social/listComments", {
	comicId: comic.id,
});
assert(
	data<{ count: number }>(adminListing).count === 2,
	"admin listing still counts both (hidden included)",
);
const hideAgain = await admin.rpc("/admin/resolveReport", {
	id: reportRow.id,
	action: "dismiss",
});
assert(hideAgain.status === 409, "resolving the same report twice → 409");

/* 6. takedown: gone from anon browse, unreadable by owner and reader */
const takedown = await admin.rpc("/admin/setTakedown", {
	comicId: comic.id,
	takenDown: true,
	reason: "test policy violation",
});
assert(takedown.status === 200, "setTakedown(takenDown=true) → 200");
const comicRow = await db.comic.findUniqueOrThrow({ where: { id: comic.id } });
assert(
	comicRow.takenDownAt !== null &&
		comicRow.takedownReason === "test policy violation" &&
		comicRow.visibility === "private" &&
		comicRow.status === "draft",
	"takedown set the fields and forced private + draft (invariant 11)",
);
const anonBrowse = await anonRpc("/reading/browse", { limit: 100 });
assert(
	!anonBrowse.text.includes(comic.slug),
	"taken-down comic absent from anonymous browse",
);
const ownerRead = await creator.rpc("/reading/read", {
	kind: "comic",
	ref: { id: comic.id },
});
assert(
	ownerRead.status === 404,
	"owner's own read of the taken-down comic → 404",
);
const pageImage = await app.request(`http://localhost/pages/${pages[0]!.id}`, {
	headers: { cookie: creator.cookie },
});
assert(pageImage.status === 404, "owner cannot fetch the page image either");
const ownerComment = await creator.rpc("/social/comment", {
	comicId: comic.id,
	body: "still here?",
});
assert(
	ownerComment.status === 404,
	"even the owner commenting on the taken-down comic → 404 (canView is the only door)",
);
const adminRead = await admin.rpc("/reading/read", {
	kind: "comic",
	ref: { id: comic.id },
});
assert(adminRead.status === 200, "admin still sees the taken-down comic");

/* 7. untakedown: restores the OWNER's access only */
const untakedown = await admin.rpc("/admin/setTakedown", {
	comicId: comic.id,
	takenDown: false,
});
assert(untakedown.status === 200, "setTakedown(takenDown=false) → 200");
const after = await db.comic.findUniqueOrThrow({ where: { id: comic.id } });
assert(
	after.takenDownAt === null &&
		after.takedownReason === null &&
		after.visibility === "private" &&
		after.status === "draft",
	"untakedown cleared the fields and left the comic private + draft",
);
const ownerRead2 = await creator.rpc("/reading/read", {
	kind: "comic",
	ref: { id: comic.id },
});
assert(ownerRead2.status === 200, "owner's read restored");
const readerRead = await reader.rpc("/reading/read", {
	kind: "comic",
	ref: { id: comic.id },
});
assert(
	readerRead.status === 404,
	"another reader's access NOT restored — private stays until republish",
);

console.log("E2E SOCIAL OK");
await db.$disconnect();
process.exit(0);
