import { error } from "@sveltejs/kit";
import { serverClient } from "$lib/orpc.server";
import type { PageServerLoad } from "./$types";

/**
 * Comic + chapters + (for a viewer) shelf/follow/rating/comments, all
 * server-rendered. The booleans below are the initial state the toggles
 * start from — the truth comes from the server, never from localStorage.
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

	// Ruling 2026-09-14: comment reads are public. The list renders for
	// anonymous too — only the write-side state (rating) stays signed-in.
	const [comments, rating, saved, following] = await Promise.all([
		client.social
			.listComments({ comicId: read.comic.id, limit: 20 })
			.catch(() => null),
		signedIn
			? client.social
					.ratingSummary({ comicId: read.comic.id })
					.catch(() => null)
			: null,
		signedIn
			? client.reading.isSaved({ comicId: read.comic.id }).catch(() => false)
			: false,
		signedIn
			? client.social
					.isFollowing({ creatorId: read.comic.creator.id })
					.catch(() => false)
			: false,
	]);

	return {
		comic: read.comic,
		synopsis: read.synopsis,
		chapters: read.chapters,
		signedIn,
		rating,
		comments,
		saved,
		following,
	};
};
