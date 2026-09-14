import { serverClient } from "$lib/orpc.server";
import type { LayoutServerLoad } from "./$types";

/**
 * The header's role-aware items (Perpustakaan, Unggah, Admin) and the auth
 * controls must exist in the server-rendered HTML, so the viewer's role is
 * resolved here rather than in a client query. Components render from these
 * props; after sign-in/sign-out the layout reload refreshes them.
 */
export const load: LayoutServerLoad = async ({ cookies }) => {
	const me = await serverClient(cookies)
		.reading.me()
		.catch(() => null);
	return {
		signedIn: Boolean(me?.signedIn),
		role: me?.role ?? null,
	};
};
