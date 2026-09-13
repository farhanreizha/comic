/**
 * E2E smoke for the write path: generates a real CBZ, uploads it through the
 * real Hono app (multipart POST /publish/chapters) with a real session
 * cookie, then reads the result back through the READING path — /pages/:id
 * returns the image bytes and page order matches. Run from apps/server/:
 *   bun e2e-publishing.ts
 */
import { viewerFromSession } from "@comic/api/routers/reading";
import { createPrismaClient } from "@comic/db";
import { createReading } from "@comic/reading";
import { createPrismaComicData } from "@comic/reading/adapters/prisma";
import { createStorageFilesPort } from "@comic/reading/adapters/storage-files";
import { zipSync } from "fflate";
import { env } from "./src/env.server";
import { app } from "./src/index";
import { auth, getDb, storage } from "./src/services";

const db = createPrismaClient(env);

const assert = (cond: unknown, msg: string): void => {
	if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
	console.log(`ok — ${msg}`);
};

/** 1x1 PNG with a unique byte so page order is provable from served bytes. */
const pngWith = (seed: number): Uint8Array => {
	const b = new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
		0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0x00, 0x00, 0x00, 0x0a,
		0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05,
		0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
		0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
	]);
	b[b.length - 12] = seed;
	return b;
};

/* 1. creator session through the real auth handler */
await db.comic.deleteMany({ where: { title: "E2E Publish Comic" } });
await db.user.deleteMany({ where: { name: "E2E Publisher" } });

const email = `e2e-pub-${Date.now()}@example.com`;
const signUpRes = await auth.handler(
	new Request("http://localhost/api/auth/sign-up/email", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			email,
			password: "e2e-password-123",
			name: "E2E Publisher",
		}),
	}),
);
const cookieHeader: string = signUpRes.headers.get("set-cookie") ?? "";
assert(cookieHeader !== "", "signup returned a session cookie");
const user = await db.user.findUniqueOrThrow({ where: { email } });
await db.user.update({ where: { id: user.id }, data: { role: "creator" } });

// Same wire format a browser's oRPC client speaks: JSON body under "json".
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

/* 2. createComic over the oRPC router */
const createRes = await rpc("/publishing/createComic", {
	title: "E2E Publish Comic",
});
const comic = createRes.data as {
	id: string;
	slug: string;
	visibility: string;
	status: string;
};
assert(
	createRes.status === 200 &&
		comic.id !== undefined &&
		comic.visibility === "private" &&
		comic.status === "draft",
	`createComic via oRPC → private draft (slug ${comic.slug})`,
);

/* 3. a REAL CBZ: 3 PNG pages with natural-order-breaking names + ComicInfo.xml */
const cbz = zipSync({
	"page1.png": pngWith(11),
	"page2.png": pngWith(22),
	"page10.png": pngWith(33),
	"ComicInfo.xml": new TextEncoder().encode("<ComicInfo><x/></ComicInfo>"),
});

/* 4. multipart POST /publish/chapters through the real Hono app */
const form = new FormData();
form.set("comicId", comic.id);
form.set(
	"archive",
	new File([cbz], "chapter.cbz", {
		type: "application/vnd.comicbook+zip",
	}),
);
const upRes = await app.request("/publish/chapters", {
	method: "POST",
	headers: { cookie: cookieHeader },
	body: form,
});
const chapter = (await upRes.json()) as {
	id: string;
	ordinal: number;
	pageCount: number;
	title: string;
};
assert(
	upRes.status === 201,
	`multipart CBZ upload → 201 (${JSON.stringify(chapter).slice(0, 120)})`,
);
assert(
	chapter.ordinal === 1 && chapter.pageCount === 3,
	"chapter 1 with exactly 3 image pages (ComicInfo.xml ignored)",
);

/* 5. read the result back through the READING path (owner viewer) */
const reading = createReading({
	data: createPrismaComicData(await getDb()),
	files: createStorageFilesPort(storage),
});
const viewer = viewerFromSession({
	user: { id: user.id, role: "creator" },
});
const chRead = await reading.read(viewer, {
	kind: "chapter",
	chapterId: chapter.id,
});
assert(
	chRead.kind === "chapter" && chRead.pages.length === 3,
	"reading path returns the ingested chapter with 3 pages",
);

/* 6. page order: natural, not lexical — and /pages/:id serves the exact bytes */
const expectedSeed: Record<number, number> = { 1: 11, 2: 22, 3: 33 };
const expectedName: Record<number, string> = {
	1: "page1.png",
	2: "page2.png",
	3: "page10.png",
};
if (chRead.kind === "chapter") {
	for (const p of chRead.pages) {
		const res = await app.request(`http://localhost/pages/${p.id}`, {
			headers: { cookie: cookieHeader },
		});
		const bytes = new Uint8Array(await res.arrayBuffer());
		assert(
			res.status === 200 &&
				res.headers.get("content-type") === "image/png" &&
				bytes.length === pngWith(0).length &&
				bytes[bytes.length - 12] === expectedSeed[p.number],
			`GET /pages/:id for page ${p.number} serves the ${expectedName[p.number]} bytes (${bytes.length}B)`,
		);
	}
}

/* 7. cover follows the first chapter = page 1, served via the image route */
const comicRead = await reading.read(viewer, {
	kind: "comic",
	ref: { slug: comic.slug },
});
const coverUrl = comicRead.kind === "comic" ? comicRead.comic.coverUrl : null;
assert(
	coverUrl !== null && coverUrl.startsWith("/pages/"),
	`comic.coverUrl = ${coverUrl} (first page of chapter 1)`,
);
const coverRes = await app.request(`http://localhost${coverUrl as string}`, {
	headers: { cookie: cookieHeader },
});
assert(coverRes.status === 200, "cover bytes served through /pages/:id");

/* 8. loose-images upload → chapter 2; ordinal increments transactionally */
const imgForm = new FormData();
imgForm.set("comicId", comic.id);
imgForm.set("images", new File([pngWith(44)], "p1.png", { type: "image/png" }));
const imgRes = await app.request("/publish/chapters", {
	method: "POST",
	headers: { cookie: cookieHeader },
	body: imgForm,
});
const ch2 = (await imgRes.json()) as { ordinal: number; pageCount: number };
assert(
	imgRes.status === 201 && ch2.ordinal === 2 && ch2.pageCount === 1,
	"multipart images upload → chapter 2",
);

/* 8b. same ingest through the oRPC channel (File rides the FormData body) */
// Client wire format: FormData with `data` = JSON {json: input}, blobs keyed
// by index — matches @orpc/client's serializer exactly.
const rpcForm = new FormData();
rpcForm.set(
	"data",
	JSON.stringify({
		json: {
			kind: "archive",
			comicId: comic.id,
			title: "Via RPC",
			archive: {}, // placeholder replaced by maps + blob "0"
		},
		maps: [["archive"]],
	}),
);
rpcForm.set("0", new File([zipSync({ "p1.png": pngWith(66) })], "rpc.cbz"));
const rpcUpRes = await app.request(
	"http://localhost/rpc/publishing/ingestChapter",
	{ method: "POST", headers: { cookie: cookieHeader }, body: rpcForm },
);
const rpcUpBody = (await rpcUpRes.json()) as { json?: unknown };
const rpcCh = rpcUpBody.json as {
	ordinal: number;
	pageCount: number;
	title: string;
};
assert(
	rpcUpRes.status === 200 &&
		rpcCh.ordinal === 3 &&
		rpcCh.pageCount === 1 &&
		rpcCh.title === "Via RPC",
	"oRPC ingestChapter (FormData+File) → chapter 3",
);

/* 9. private draft stays invisible: anon browse + page bytes 404 */
const anonBrowse = await app.request("http://localhost/rpc/reading/browse", {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ json: {} }),
});
assert(
	!(await anonBrowse.text()).includes(comic.slug),
	"private draft comic absent from anonymous browse",
);
const firstPageId = chRead.kind === "chapter" ? chRead.pages[0]?.id : undefined;
const anonPage = await app.request(
	`http://localhost/pages/${firstPageId ?? "none"}`,
);
assert(anonPage.status === 404, "page bytes unreachable anonymously");

/* 10. replaceChapter through the same multipart door; replaced rows vanish */
const replaceForm = new FormData();
replaceForm.set("chapterId", chapter.id);
replaceForm.set(
	"archive",
	new File([zipSync({ "only.png": pngWith(55) })], "fix.cbz"),
);
const repRes = await app.request("/publish/chapters", {
	method: "POST",
	headers: { cookie: cookieHeader },
	body: replaceForm,
});
const rep = (await repRes.json()) as { pageCount: number; ordinal: number };
assert(
	repRes.status === 201 && rep.pageCount === 1 && rep.ordinal === 1,
	"replaceChapter → 201, 1 page, same ordinal",
);
const gone = await app.request(
	`http://localhost/pages/${firstPageId ?? "none"}`,
	{ headers: { cookie: cookieHeader } },
);
assert(gone.status === 404, "replaced page row is gone from the read path");

/* 11. unauthenticated multipart → 401 */
const noAuth = await app.request("/publish/chapters", {
	method: "POST",
	body: form,
});
assert(noAuth.status === 401, "upload without a session → 401");

/* 12. storage holds no raw archive: only page keys under comics/ exist */
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
const stored = await walk(env.STORAGE_DIR ?? "./.storage");
const pageKeys = stored.filter(
	(p) => p.includes(`/comics/${comic.id}/`) && !p.endsWith(".meta.json"),
);
// 1 surviving replaced-chapter page + 1 chapter-2 page + 1 RPC chapter-3 page;
// the 3 original keys were deleted after the replace committed (invariant 5).
assert(
	pageKeys.length === 3,
	`stored page files for the comic = ${pageKeys.length} (archives themselves are never stored)`,
);
assert(
	!stored.some((p) => p.endsWith(".cbz") || p.includes("chapter.cbz")),
	"no raw .cbz anywhere on disk",
);

console.log("E2E PUBLISHING OK");
await db.$disconnect();
process.exit(0);
