/**
 * PDF smoke for POST /publish/chapters: multipart-upload a real PDF as the
 * `archive` field, assert pages arrive as PNGs through the READING path, and
 * an encrypted PDF comes back as 400 INVALID_INPUT. Run from apps/server/:
 *   bun e2e-pdf.ts
 */
import { createPrismaClient } from "@comic/db";
import { env } from "./src/env.server";
import { app } from "./src/index";
import { auth } from "./src/services";

const FIXTURES = new URL(
	"../../packages/publishing/test/fixtures/",
	import.meta.url,
);

const db = createPrismaClient(env);
const assert = (cond: unknown, msg: string): void => {
	if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
	console.log(`ok — ${msg}`);
};

await db.comic.deleteMany({ where: { title: "E2E PDF Comic" } });
await db.user.deleteMany({ where: { name: "E2E PDFer" } });

const email = `e2e-pdf-${Date.now()}@example.com`;
const signUpRes = await auth.handler(
	new Request("http://localhost/api/auth/sign-up/email", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			email,
			password: "e2e-password-123",
			name: "E2E PDFer",
		}),
	}),
);
const cookieHeader: string = signUpRes.headers.get("set-cookie") ?? "";
assert(cookieHeader !== "", "signup cookie");
const user = await db.user.findUniqueOrThrow({ where: { email } });
await db.user.update({
	where: { id: user.id },
	data: { role: "creator" },
});

const comic = await db.comic.create({
	data: {
		slug: `e2e-pdf-${Date.now()}`,
		title: "E2E PDF Comic",
		ownerId: user.id,
		visibility: "public",
		status: "published",
	},
});

const pdfBytes = new Uint8Array(
	await Bun.file(FIXTURES.pathname + "fixture-3page.pdf").arrayBuffer(),
);
const form = new FormData();
form.set("comicId", comic.id);
form.set(
	"archive",
	new File([pdfBytes.buffer as ArrayBuffer], "manga.pdf", {
		type: "application/pdf",
	}),
);
const upRes = await app.request(
	"/publish/chapters",
	{
		method: "POST",
		headers: { cookie: cookieHeader },
		body: form,
	},
	{ url: "http://localhost/publish/chapters" },
);
assert(upRes.status === 201, `PDF upload → 201 (got ${upRes.status})`);
const chapter = (await upRes.json()) as { pageCount: number; id: string };
assert(chapter.pageCount === 3, "3 pages ingested from the PDF");

const pages = await db.page.findMany({
	where: { chapterId: chapter.id },
	orderBy: { number: "asc" },
});
assert(pages.length === 3, "3 page rows");
assert(
	pages.every((p) => p.contentType === "image/png" && p.width > 0),
	"all PNG with decoded dimensions",
);

// served through the read path
const imgRes = await app.request(
	`/pages/${pages[0]!.id}`,
	{ headers: { cookie: cookieHeader } },
	{ url: "http://localhost/pages/x" },
);
assert(imgRes.status === 200, "page bytes served");
assert(
	imgRes.headers.get("content-type") === "image/png",
	"served as image/png",
);

// encrypted PDF → 400 INVALID_INPUT
const encBytes = new Uint8Array(
	await Bun.file(FIXTURES.pathname + "fixture-enc.pdf").arrayBuffer(),
);
const form2 = new FormData();
form2.set("comicId", comic.id);
form2.set(
	"archive",
	new File([encBytes.buffer as ArrayBuffer], "locked.pdf", {
		type: "application/pdf",
	}),
);
const encRes = await app.request(
	"/publish/chapters",
	{ method: "POST", headers: { cookie: cookieHeader }, body: form2 },
	{ url: "http://localhost/publish/chapters" },
);
assert(encRes.status === 400, `encrypted PDF → 400 (got ${encRes.status})`);
const encJson = (await encRes.json()) as { code: string };
assert(encJson.code === "INVALID_INPUT", "encrypted → INVALID_INPUT");

// cleanup
await db.comic.delete({ where: { id: comic.id } });
await db.user.delete({ where: { id: user.id } });
console.log("E2E PDF OK");
process.exit(0);
