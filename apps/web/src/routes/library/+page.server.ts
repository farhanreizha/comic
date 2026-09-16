import { serverClient } from "$lib/orpc.server";
import type { PageServerLoad } from "./$types";

/** Signed-in viewers get the shelf server-rendered; signed-out stays honest.
 *  Issue #42: the query stays a pending promise so the route shell + skeleton
 *  stream to the browser first; {#await} in +page.svelte renders it on resolve. */
export const load: PageServerLoad = ({ cookies }) => {
	const client = serverClient(cookies);
	return {
		shelfData: (async () => {
			const me = await client.reading.me().catch(() => null);
			const signedIn = Boolean(me?.signedIn);
			const shelf = signedIn
				? await client.reading.shelf().catch(() => null)
				: null;
			return { signedIn, shelf };
		})(),
	};
};
