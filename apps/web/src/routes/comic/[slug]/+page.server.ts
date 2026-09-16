import { error } from "@sveltejs/kit";
import { serverClient } from "$lib/orpc.server";
import type { PageServerLoad } from "./$types";

/**
 * Comic + chapters (the visual anchor) are awaited so 404/403 status codes
 * survive a direct hit. Shelf/follow/rating/comments return as ONE pending
 * promise: SvelteKit streams it (issue #42), so the cover and metadata paint
 * immediately and {#await} in +page.svelte swaps the skeleton on resolve.
 * Every call .catches internally — the streamed promise never rejects, which
 * keeps the "unhandled rejection during stream" footgun impossible.
 */
export const load: PageServerLoad = async ({ params, cookies }) => {
	const client = serverClient(cookies);
	let read: Awaited<ReturnType<typeof client.reading.read>>;
	try {
		read = await client.reading.read({
			kind: "comic",
			ref: { slug: params.slug },
		});
	} catch (cause) {
		const code = (cause as { code?: string }).code;
		if (code === "NOT_FOUND" || code === "UNAUTHORIZED")
			error(404, "not found");
		throw cause;
	}
	if (read.kind !== "comic") error(404, "not found");

	const me = await client.reading.me().catch(() => null);
	const signedIn = Boolean(me?.signedIn);
	// Owner affordance: admins and the comic's creator get the chapter entry
	// point (read already passed canView, so this viewer may see the comic).
	const canManage =
		me?.signedIn === true &&
		(me.role === "admin" ||
			(me.id !== null && me.id === read.comic.creator.id));

	const comicId = read.comic.id;
	const creatorId = read.comic.creator.id;

	// Ruling 2026-09-14: comment reads are public. The list renders for
	// anonymous too — only the write-side state (rating) stays signed-in.
	const aux = (async () => {
		const [comments, rating, saved, following] = await Promise.all([
			client.social.listComments({ comicId, limit: 20 }).catch(() => null),
			signedIn
				? client.social.ratingSummary({ comicId }).catch(() => null)
				: null,
			signedIn ? client.reading.isSaved({ comicId }).catch(() => false) : false,
			signedIn
				? client.social.isFollowing({ creatorId }).catch(() => false)
				: false,
		]);
		return { comments, rating, saved, following };
	})();

	return {
		comic: read.comic,
		synopsis: read.synopsis,
		chapters: read.chapters,
		signedIn,
		canManage,
		aux,
	};
};
