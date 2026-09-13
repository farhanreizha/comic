/**
 * E2E smoke for the reading foundation: boots the real Hono app (no network),
 * signs up a creator via better-auth, seeds Comic/Chapter/Page + storage files,
 * then exercises browse via the oRPC router and page images via GET /pages/:id.
 * Run from apps/server/: bun e2e-reading.ts
 */
import { createPrismaClient } from "@comic/db";
import { createDiskStorage } from "@comic/storage";
import { env } from "./src/env.server";
import { app } from "./src/index";
import { auth } from "./src/services";

const db = createPrismaClient(env);

// Clean slate for repeated runs: e2e rows are keyed on unique storage keys/titles.
await db.comic.deleteMany({
	where: { title: { in: ["E2E Comic", "Private", "Unlisted"] } },
});
await db.user.deleteMany({ where: { name: "E2E Creator" } });

const email = `e2e-${Date.now()}@example.com`;
const password = "e2e-password-123";

// 1. sign up through better-auth's HTTP handler (local, no network)
const signUpRes = await auth.handler(
	new Request("http://localhost/api/auth/sign-up/email", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password, name: "E2E Creator" }),
	}),
);
const cookieHeader: string = signUpRes.headers.get("set-cookie") ?? "";
if (!cookieHeader)
	throw new Error(`no session cookie from signUp: ${await signUpRes.text()}`);
console.log("signup ok, session cookie set");

// 2. promote to creator + seed a comic with one chapter, two pages
const user = await db.user.findUniqueOrThrow({ where: { email } });
await db.user.update({ where: { id: user.id }, data: { role: "creator" } });
const comic = await db.comic.create({
	data: {
		slug: `e2e-${Date.now()}`,
		title: "E2E Comic",
		visibility: "public",
		status: "published",
		ownerId: user.id,
		genres: ["action", "sci_fi"],
		chapters: {
			create: {
				ordinal: 1,
				title: "Chapter 1",
				pages: {
					create: [
						{
							number: 1,
							storageKey: "e2e/page-1.png",
							contentType: "image/png",
						},
						{
							number: 2,
							storageKey: "e2e/page-2.png",
							contentType: "image/png",
						},
					],
				},
			},
		},
	},
	include: { chapters: { include: { pages: true } } },
});
const chapter = comic.chapters[0] as (typeof comic.chapters)[number];
const page1 = chapter.pages[0] as (typeof chapter.pages)[number];

// 3. put real page bytes into disk storage via the storage module
const disk = createDiskStorage(env.STORAGE_DIR ?? "./.storage");
const png1x1 = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
	0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02,
	0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
	0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a,
	0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60,
	0x82,
]);
await disk.put("e2e/page-1.png", { bytes: png1x1, contentType: "image/png" });
await disk.put("e2e/page-2.png", { bytes: png1x1, contentType: "image/png" });
console.log("seeded comic", comic.id, "chapter", chapter.id, "page", page1.id);

// 4. browse anonymously through the real Hono app (same path as any client)
const anonReq = new Request("http://localhost/rpc/reading/browse", {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ input: {} }),
});
const anonRes = await app.request(anonReq);
const anonBody = await anonRes.json();
console.log("anon browse:", JSON.stringify(anonBody).slice(0, 300));
if (!JSON.stringify(anonBody).includes(comic.slug)) {
	throw new Error("created comic missing from anon browse");
}

// 5. GET /pages/:id — cookie (owner) vs anonymous (public page: both 200)
const authed = await app.request(`/pages/${page1.id}`, {
	headers: { cookie: cookieHeader },
});
const anon = await app.request(`/pages/${page1.id}`);
console.log(
	"public page authed:",
	authed.status,
	authed.headers.get("content-type"),
);
console.log("public page anon:", anon.status, anon.headers.get("content-type"));
const bytes = new Uint8Array(await authed.arrayBuffer());
if (authed.status !== 200 || anon.status !== 200 || bytes.length === 0) {
	throw new Error("public page image not served");
}

// 6. private comic page must 404 for anon, 200 for owner
const privateComic = await db.comic.create({
	data: {
		slug: `e2e-priv-${Date.now()}`,
		title: "Private",
		visibility: "private",
		status: "published",
		ownerId: user.id,
		chapters: {
			create: {
				ordinal: 1,
				title: "P",
				pages: {
					create: [
						{
							number: 1,
							storageKey: "e2e/priv-1.png",
							contentType: "image/png",
						},
					],
				},
			},
		},
	},
	include: { chapters: { include: { pages: true } } },
});
const privPage = (
	privateComic.chapters[0] as (typeof privateComic.chapters)[number]
).pages[0] as {
	id: string;
};
await disk.put("e2e/priv-1.png", { bytes: png1x1, contentType: "image/png" });
const privAnon = await app.request(`/pages/${privPage.id}`);
const privOwner = await app.request(`/pages/${privPage.id}`, {
	headers: { cookie: cookieHeader },
});
console.log(
	"private page anon:",
	privAnon.status,
	"| owner:",
	privOwner.status,
);
if (privAnon.status !== 404)
	throw new Error("private page leaked to anonymous");
if (privOwner.status !== 200)
	throw new Error("private page blocked from owner");

// 7. unlisted comic: absent from anon browse, reachable by slug via read
const unlisted = await db.comic.create({
	data: {
		slug: `e2e-unlisted-${Date.now()}`,
		title: "Unlisted",
		visibility: "unlisted",
		status: "published",
		ownerId: user.id,
	},
});
const browse2 = await app.request("http://localhost/rpc/reading/browse", {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ input: { limit: 100 } }),
});
const browseBody = await browse2.json();
if (JSON.stringify(browseBody).includes(unlisted.slug)) {
	throw new Error("unlisted comic appeared in anon browse");
}
console.log("unlisted correctly absent from anon browse");

console.log("E2E OK");
await db.$disconnect();
process.exit(0);
