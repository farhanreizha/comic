import type { Context as ApiContext } from "@comic/api/context";
import { viewerFromSession } from "@comic/api/routers/reading";
import type { Role, Viewer } from "@comic/reading";
import type { Context as HonoContext } from "hono";
import { auth, getDb, storage } from "./services";

export type CreateContextOptions = {
	context: HonoContext;
};

/**
 * viewerFromSession cannot see the role (better-auth sessions carry no user
 * fields beyond its defaults) — resolve it from the user row. One extra
 * indexed lookup per authenticated request; cache only when it shows up in a
 * profile.
 */
export async function viewerWithRole(
	session: { user: { id: string } } | null | undefined,
): Promise<Viewer> {
	if (!session) return viewerFromSession(null);
	const db = await getDb();
	const user = await db.user.findUnique({
		where: { id: session.user.id },
		select: { role: true },
	});
	const role: Role =
		user?.role === "creator" || user?.role === "admin" ? user.role : "reader";
	return { kind: "user", id: session.user.id, role };
}

export async function createContext({
	context,
}: CreateContextOptions): Promise<ApiContext> {
	const db = await getDb();
	const session = await auth.api.getSession({
		headers: context.req.raw.headers,
	});
	return {
		db,
		auth: null,
		session,
		storage,
		viewer: await viewerWithRole(session),
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
