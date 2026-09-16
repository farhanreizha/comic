import { createPrismaClient } from "@comic/db";
import { env } from "./src/env.server";

const db = createPrismaClient(env);

async function check() {
	const count = await db.comic.count();
	console.log("Comic count:", count);

	const comics = await db.comic.findMany({
		select: { id: true, slug: true, coverUrl: true },
		take: 3,
	});
	console.log("Comics:", JSON.stringify(comics, null, 2));
}

check().catch(console.error);
