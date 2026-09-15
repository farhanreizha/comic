/**
 * E2E smoke for issue #6 (creator comic management): updateComic and
 * deleteComic go through the real oRPC router, the real Prisma adapter, and
 * the real disk storage — delete must cascade chapters/pages rows AND leave
 * zero page bytes on disk for the deleted comic. Run from apps/server/:
 *   bun e2e-manage.ts
 */
import { createPrismaClient } from "@comic/db";
import { env } from "./src/env.server";
import { app } from "./src/index";
import { auth } from "./src/services";

const db = createPrismaClient(env);

const assert = (cond: unknown, msg: string): void => {
	if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
	console.log(`ok — ${msg}`);
};

const png = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
	0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02,
	0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
	0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a,
	0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60,
	0x82,
]);

/* 1. creator session */
await db.comic.deleteMany({ where: { title: "E2E Manage Comic" } });
await db.user.deleteMany({ where: { name: "E2E Manager" } });
const email = `e2e-mgr-${Date.now()}@example.com`;
const signUpRes = await auth.handler(
	new Request("http://localhost/api/auth/sign-up/email", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			email,
			password: "e2e-password-123",
			name: "E2E Manager",
		}),
	}),
);
const cookieHeader: string = signUpRes.headers.get("set-cookie") ?? "";
assert(cookieHeader !== "", "signup returned a session cookie");
const user = await db.user.findUniqueOrThrow({ where: { email } });
await db.user.update({ where: { id: user.id }, data: { role: "creator" } });

const rpc = async (path: string, input: unknown) => {
	const res = await app.request(`http://localhost/rpc${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", cookie: cookieHeader },
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

/* 2. create + ingest one chapter through the real upload route */
const createRes = await rpc("/publishing/createComic", {
	title: "E2E Manage Comic",
});
const comic = createRes.data as { id: string; slug: string };
assert(createRes.status === 200 && comic.id !== undefined, "createComic ok");

const form = new FormData();
form.set("comicId", comic.id);
form.set("images", new File([png], "p1.png", { type: "image/png" }));
form.append("images", new File([png], "p2.png", { type: "image/png" }));
const upRes = await app.request("/publish/chapters", {
	method: "POST",
	headers: { cookie: cookieHeader },
	body: form,
});
assert(upRes.status === 201, "2-page chapter uploaded");

/* 3. updateComic through oRPC: rename + synopsis + genres + visibility */
const upd = await rpc("/publishing/updateComic", {
	comicId: comic.id,
	title: "E2E Managed Comic",
	synopsis: "edited synopsis",
	genres: ["action", "comedy"],
	visibility: "unlisted",
});
const card = upd.data as {
	title: string;
	status: string;
	visibility: string;
	genres: string[];
};
assert(
	upd.status === 200 &&
		card.title === "E2E Managed Comic" &&
		card.visibility === "unlisted" &&
		card.genres.length === 2,
	`updateComic persisted via Prisma (${upd.text.slice(0, 100)})`,
);
// Decision #2: the draft stays a draft through oRPC too.
assert(card.status === "draft", "updateComic never published the draft");
const row = await db.comic.findUniqueOrThrow({ where: { id: comic.id } });
assert(row.synopsis === "edited synopsis", "synopsis landed on the row");

/* 4. foreign viewer cannot edit: a second reader session → FORBIDDEN */
const readerEmail = `e2e-mgr-rd-${Date.now()}@example.com`;
const rdRes = await auth.handler(
	new Request("http://localhost/api/auth/sign-up/email", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			email: readerEmail,
			password: "e2e-password-123",
			name: "E2E Meddler",
		}),
	}),
);
const rdCookie: string = rdRes.headers.get("set-cookie") ?? "";
const rdUpd = await (async () => {
	const res = await app.request("http://localhost/rpc/publishing/updateComic", {
		method: "POST",
		headers: { "content-type": "application/json", cookie: rdCookie },
		body: JSON.stringify({ json: { comicId: comic.id, title: "hijacked" } }),
	});
	return res.status;
})();
assert(rdUpd === 403, `reader updateComic → 403 (got ${rdUpd})`);
const rdDel = await (async () => {
	const res = await app.request("http://localhost/rpc/publishing/deleteComic", {
		method: "POST",
		headers: { "content-type": "application/json", cookie: rdCookie },
		body: JSON.stringify({ json: { comicId: comic.id } }),
	});
	return res.status;
})();
assert(rdDel === 403, `reader deleteComic → 403 (got ${rdDel})`);

/* 5. page bytes exist before delete */
const { readdir, stat } = await import("node:fs/promises");
const { join } = await import("node:path");
const walk = async (dir: string): Promise<string[]> => {
	const out: string[] = [];
	for (const entry of await readdir(dir).catch(() => [])) {
		const p = join(dir, entry);
		out.push(...((await stat(p)).isDirectory() ? await walk(p) : [p]));
	}
	return out;
};
const pageFiles = async () =>
	(
		await walk(join(env.STORAGE_DIR ?? "./.storage", "comics", comic.id))
	).filter((p) => !p.endsWith(".meta.json"));
const listed = await pageFiles();
assert(
	listed.length === 2,
	`2 page keys under storage before delete (got ${listed.length})`,
);

/* 6. deleteComic: rows gone, bytes gone */
const del = await rpc("/publishing/deleteComic", { comicId: comic.id });
assert(del.status === 200, `deleteComic → 200 (${del.text.slice(0, 80)})`);
assert(
	(await db.comic.findUnique({ where: { id: comic.id } })) === null,
	"comic row gone",
);
assert(
	(await db.chapter.count({ where: { comicId: comic.id } })) === 0,
	"chapters cascaded",
);
assert(
	(await db.page.count({ where: { chapter: { comicId: comic.id } } })) === 0,
	"pages cascaded",
);
const after = await pageFiles();
assert(after.length === 0, "page storage keys deleted (disk empty)");

console.log("E2E MANAGE OK");
await db.$disconnect();
process.exit(0);
