import { GENRES, type Genre } from "$lib/genres";
import { serverClient } from "$lib/orpc.server";
import type { PageServerLoad } from "./$types";

/** Browse is fully public; the cursor in the URL keeps paging link-addressable.
 *  Issue #42: the first catalogue page streams as a promise (grid shows a
 *  skeleton until it resolves); the shell — search + filters — paints at once.
 *  The .catch() below is part of the contract: a streamed promise must never
 *  reject, or SSR dies mid-stream (same fallback the awaited version had). */
export const load: PageServerLoad = async ({ url, cookies }) => {
	const q = url.searchParams.get("q")?.trim() || undefined;
	const genreParam = url.searchParams.get("genre");
	const genre: Genre | undefined = GENRES.includes(genreParam as Genre)
		? (genreParam as Genre)
		: undefined;
	const cursor = url.searchParams.get("cursor") || undefined;
	return {
		page1: serverClient(cookies)
			.reading.browse({ q, genre, cursor, limit: 20 })
			.catch((error) => {
				// Transient API failure: fall back to the client-side query.
				console.error("[browse load]", error);
				return { items: [], nextCursor: null };
			}),
	};
};
