import { createReading } from "@comic/reading";
import { createPrismaComicData } from "@comic/reading/adapters/prisma";
import { createStorageFilesPort } from "@comic/reading/adapters/storage-files";
import { Hono } from "hono";

import { viewerWithRole } from "./context";
import { auth, getDb, storage } from "./services";

/**
 * Page-image route. Bytes leave the server through exactly one door:
 * `read(viewer, { kind: "page" })`, which enforces canView internally.
 */
export const pagesApp = new Hono();

pagesApp.get("/pages/:id", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	const viewer = await viewerWithRole(session);
	const reading = createReading({
		data: createPrismaComicData(await getDb()),
		files: createStorageFilesPort(storage),
	});
	try {
		const result = await reading.read(viewer, {
			kind: "page",
			pageId: c.req.param("id"),
		});
		if (result.kind !== "page") return c.notFound();
		return new Response(result.bytes, {
			headers: {
				"content-type": result.contentType,
				"cache-control": "private, max-age=300",
			},
		});
	} catch (error) {
		if ((error as { code?: string }).code === "NOT_FOUND") return c.notFound();
		throw error;
	}
});
