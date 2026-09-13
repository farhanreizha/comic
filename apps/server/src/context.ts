import type { Context as ApiContext } from "@comic/api/context";
import { viewerFromSession } from "@comic/api/routers/reading";
import type { Context as HonoContext } from "hono";
import { auth, getDb, storage } from "./services";

export type CreateContextOptions = {
	context: HonoContext;
};

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
		viewer: viewerFromSession(session),
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
