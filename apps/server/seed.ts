/**
 * Dev seeder. Wipes the (dev) database and storage, then inserts a small,
 * stable set of demo accounts, comics and social rows so `bun dev` shows a
 * real catalogue instead of leftover smoke/e2e junk.
 *
 * Run from apps/server/: `bun run seed`
 * Idempotent: it wipes first, so it is safe to re-run.
 *
 * Guard: refuses to run unless this is clearly a dev database.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createPrismaClient } from "@comic/db";
import { createDiskStorage } from "@comic/storage";
import { env } from "./src/env.server";
import { auth } from "./src/services";

const db = createPrismaClient(env);

// one transparent 1x1 PNG, reused for every page + cover
const PNG_1X1 = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
	0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02,
	0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
	0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a,
	0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60,
	0x82,
]);

const SEED_PASSWORD = "Seed1234!";

async function signup(
	email: string,
	name: string,
	role: "reader" | "creator" | "admin",
) {
	const res = await auth.handler(
		new Request("http://localhost/api/auth/sign-up/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password: SEED_PASSWORD, name }),
		}),
	);
	if (!res.headers.get("set-cookie"))
		throw new Error(`signup failed for ${email}: ${await res.text()}`);
	const user = await db.user.findUniqueOrThrow({ where: { email } });
	if (role !== "reader")
		await db.user.update({ where: { id: user.id }, data: { role } });
	return user;
}

async function seedComic(
	ownerId: string,
	c: {
		slug: string;
		title: string;
		synopsis: string;
		genres: any[];
		visibility?: "public" | "unlisted" | "private";
		chapters: { title: string; pages: number }[];
	},
) {
	const comic = await db.comic.create({
		data: {
			slug: c.slug,
			title: c.title,
			synopsis: c.synopsis,
			visibility: c.visibility ?? "public",
			status: "published",
			ownerId,
			genres: c.genres,
			chapters: {
				create: c.chapters.map((ch, i) => ({
					ordinal: i + 1,
					title: ch.title,
					pages: {
						create: Array.from({ length: ch.pages }, (_, p) => ({
							number: p + 1,
							storageKey: `seed/${c.slug}/c${i + 1}-p${p + 1}.png`,
							contentType: "image/png",
							width: 1,
							height: 1,
						})),
					},
				})),
			},
		},
		include: { chapters: { include: { pages: true } } },
	});
	const first = comic.chapters[0]?.pages[0];
	if (first)
		await db.comic.update({
			where: { id: comic.id },
			data: { coverUrl: `/pages/${first.id}` },
		});
	return comic;
}

async function main() {
	if (
		env.NODE_ENV === "production" ||
		/amazonaws|rds\.|heroku|supabase|neon\.tech/i.test(env.DATABASE_URL ?? "")
	) {
		throw new Error("refusing to seed a production database");
	}

	// 1. wipe (dependency order; user cascade covers most, but be explicit)
	console.log("wiping dev data...");
	await db.report.deleteMany();
	await db.comment.deleteMany();
	await db.rating.deleteMany();
	await db.follow.deleteMany();
	await db.savedComic.deleteMany();
	await db.creatorApplication.deleteMany();
	await db.chapter.deleteMany();
	await db.comic.deleteMany();
	await db.session.deleteMany();
	await db.account.deleteMany();
	await db.user.deleteMany();

	// 2. clear storage
	const root = env.STORAGE_DIR ?? "./.storage";
	if (existsSync(root)) rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	const disk = createDiskStorage(root);

	// 3. demo users
	console.log("creating users...");
	await signup("admin@comic.dev", "Admin Comic", "admin");
	const budi = await signup("budi@comic.dev", "Budi Santoso", "creator");
	const siti = await signup("siti@comic.dev", "Siti Rahayu", "creator");
	const andi = await signup("andi@comic.dev", "Andi Wijaya", "reader");

	// 4. comics + pages
	console.log("creating comics...");
	const c1 = await seedComic(budi.id, {
		slug: "pelangi-di-ufuk",
		title: "Pelangi di Ufuk",
		synopsis: "Petualangan remaja di desa pesisan menjelang badai besar.",
		genres: ["fantasy", "slice_of_life"],
		chapters: [{ title: "Chapter 1 — Angin Laut", pages: 2 }],
	});
	const c2 = await seedComic(budi.id, {
		slug: "neon-jakarta",
		title: "Neon Jakarta",
		synopsis: "Dystopia cyberpunk di ibu kota yang tak pernah tidur.",
		genres: ["sci_fi", "action"],
		chapters: [
			{ title: "Chapter 1 — Lampu Merah", pages: 1 },
			{ title: "Chapter 2 — Glitch", pages: 1 },
		],
	});
	const c3 = await seedComic(siti.id, {
		slug: "dapur-nenek",
		title: "Dapur Nenek",
		synopsis: "Komedi masak-memasak lintas generasi.",
		genres: ["comedy", "slice_of_life"],
		chapters: [{ title: "Chapter 1 — Resep Hilang", pages: 1 }],
	});
	const c4 = await seedComic(siti.id, {
		slug: "garuda-rising",
		title: "Garuda Rising",
		synopsis: "Epik pahlawan yang bangkit melawan tirani.",
		genres: ["action", "adventure"],
		visibility: "unlisted",
		chapters: [{ title: "Chapter 1 — Terbang Pertama", pages: 1 }],
	});

	// 5. put page bytes
	for (const comic of [c1, c2, c3, c4]) {
		for (const ch of comic.chapters) {
			for (const p of ch.pages)
				await disk.put(p.storageKey, {
					bytes: PNG_1X1,
					contentType: "image/png",
				});
		}
	}

	// 6. social rows (so the UI has something real to render)
	await db.comment.create({
		data: {
			comicId: c1.id,
			authorId: andi.id,
			body: "Ceritanya bagus, nunggu chapter selanjutnya!",
		},
	});
	await db.rating.create({
		data: { comicId: c1.id, userId: andi.id, value: 5 },
	});
	await db.rating.create({
		data: { comicId: c2.id, userId: andi.id, value: 4 },
	});
	await db.follow.create({ data: { followerId: andi.id, creatorId: budi.id } });
	await db.savedComic.create({ data: { userId: andi.id, comicId: c2.id } });
	await db.report.create({
		data: {
			targetType: "comic",
			targetId: c2.id,
			reporterId: andi.id,
			reason: "spam",
			status: "open",
		},
	});
	await db.creatorApplication.create({
		data: {
			userId: andi.id,
			motivation: "Saya ingin mempublikasikan komik lokal Bandung.",
		},
	});

	console.log(
		"\nSEED DONE — demo accounts (password for all: " + SEED_PASSWORD + "):",
	);
	console.log("  admin @comic.dev  (role: admin)");
	console.log("  budi  @comic.dev  (role: creator)");
	console.log("  siti  @comic.dev  (role: creator)");
	console.log(
		"  andi  @comic.dev  (role: reader, has a pending creator application + open report)",
	);
	console.log(`  comics: ${[c1, c2, c3, c4].map((c) => c.title).join(", ")}`);
	await db.$disconnect();
	process.exit(0);
}

main().catch(async (e) => {
	console.error(e);
	await db.$disconnect();
	process.exit(1);
});
