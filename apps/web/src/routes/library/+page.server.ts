import { serverClient } from "$lib/orpc.server";
import type { PageServerLoad } from "./$types";

/** Signed-in viewers get the shelf server-rendered; signed-out stays honest. */
export const load: PageServerLoad = async ({ cookies }) => {
	const client = serverClient(cookies);
	const me = await client.reading.me().catch(() => null);
	const signedIn = Boolean(me?.signedIn);
	const shelf = signedIn
		? await client.reading.shelf().catch(() => null)
		: null;
	return { signedIn, shelf };
};
