import { Hono } from "hono";

import { viewerWithRole } from "./context";
import { auth, getDb, storage } from "./services";

/**
 * Application sample download — admin-only. The storage key lives on the
 * application row and is never sent to the browser; this route resolves the
 * row by id, checks the viewer is admin, and streams bytes out of storage.
 * (docs/design/social-admin.md invariant 13: files move through storage only.)
 */
export const adminSamplesApp = new Hono();

adminSamplesApp.get("/admin/applications/:id/sample", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	const viewer = await viewerWithRole(session);
	if (viewer.kind !== "user" || viewer.role !== "admin") {
		return c.json({ code: "FORBIDDEN", message: "admin role required" }, 403);
	}
	const db = await getDb();
	const row = await db.creatorApplication.findUnique({
		where: { id: c.req.param("id") },
		select: { sampleKey: true },
	});
	if (!row?.sampleKey) return c.notFound();
	const stored = await storage.get(row.sampleKey);
	if (!stored) return c.notFound();
	return new Response(stored.bytes, {
		headers: {
			"content-type": stored.contentType,
			"content-disposition": `attachment; filename="sample-${row.sampleKey.slice(-8)}"`,
			"cache-control": "private, no-store",
		},
	});
});
