/**
 * Orphan sweep (write-path invariant 7): delete stored bytes no row
 * references — the residue of a crash between the last `put` and commit.
 * The read path can never reach them; this reclaims the disk.
 *
 * Run from apps/server/: `bun run sweep:orphans` (dry run)
 *                       `bun run sweep:orphans -- --apply` (delete)
 *
 * Guard: refuses to run against a production database (mirrors seed.ts).
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import { createPrismaClient } from "@comic/db";
import { createDiskStorage } from "@comic/storage";
import { env } from "./src/env.server";

/** Keys written in the last N minutes may belong to an in-flight ingest. */
const GRACE_MS = 15 * 60 * 1000;

async function main() {
	if (
		env.NODE_ENV === "production" ||
		/amazonaws|rds\.|heroku|supabase|neon\.tech/i.test(env.DATABASE_URL ?? "")
	) {
		throw new Error("refusing to sweep a production database");
	}

	const apply = process.argv.includes("--apply");
	const db = createPrismaClient(env);
	try {
		const storage = createDiskStorage(env.STORAGE_DIR);
		const [pages, applications] = await Promise.all([
			db.page.findMany({ select: { storageKey: true } }),
			db.creatorApplication.findMany({
				where: { sampleKey: { not: null } },
				select: { sampleKey: true },
			}),
		]);
		const referenced = new Set<string>([
			...pages.map((p) => p.storageKey),
			...applications.map((a) => a.sampleKey as string),
		]);

		const now = Date.now();
		const orphans: string[] = [];
		for (const key of await storage.list("")) {
			if (referenced.has(key)) continue;
			// ponytail: mtime check reaches past the adapter because
			// StorageAdapter is deliberately metadata-free. Upgrade path:
			// mtime in list() results once an S3/R2 adapter lands.
			const mtime = statSync(join(env.STORAGE_DIR, key), {
				throwIfNoEntry: false,
			})?.mtimeMs;
			if (mtime !== undefined && now - mtime < GRACE_MS) continue;
			orphans.push(key);
		}

		console.log(
			`${orphans.length} orphan key(s) ${apply ? "reaped" : "found (dry run — pass --apply to delete)"}`,
		);
		for (const key of orphans) {
			console.log(`  ${apply ? "reaped" : "would reap"} ${key}`);
			if (apply) await storage.delete(key);
		}
	} finally {
		await db.$disconnect();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
