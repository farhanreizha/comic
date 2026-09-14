import { GENRES, type Genre } from "$lib/genres";
import { serverClient } from "$lib/orpc.server";
import type { PageServerLoad } from "./$types";

/** Browse is fully public; the cursor in the URL keeps paging link-addressable. */
export const load: PageServerLoad = async ({ url, cookies }) => {
	const q = url.searchParams.get("q")?.trim() || undefined;
	const genreParam = url.searchParams.get("genre");
	const genre: Genre | undefined = GENRES.includes(genreParam as Genre)
		? (genreParam as Genre)
		: undefined;
	const cursor = url.searchParams.get("cursor") || undefined;
	try {
		return await serverClient(cookies).reading.browse({
			q,
			genre,
			cursor,
			limit: 20,
		});
	} catch (error) {
		// Transient API failure: fall back to the client-side query.
		console.error("[browse load]", error);
		return { items: [], nextCursor: null };
	}
};
