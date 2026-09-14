import { error } from "@sveltejs/kit";
import { serverClient } from "$lib/orpc.server";
import type { PageServerLoad } from "./$types";

/**
 * Chapter + page manifest (and the comic for back/next links) are
 * server-rendered; the scroll window and progress writes stay in the browser.
 */
export const load: PageServerLoad = async ({ params, cookies }) => {
	const client = serverClient(cookies);
	let read: Awaited<ReturnType<typeof client.reading.read>>;
	try {
		read = await client.reading.read({
			kind: "chapter",
			chapterId: params.chapterId,
		});
	} catch (cause) {
		const code = (cause as { code?: string }).code;
		if (code === "NOT_FOUND" || code === "UNAUTHORIZED")
			error(404, "not found");
		throw cause;
	}
	if (read.kind !== "chapter") error(404, "not found");

	const [comicRead, me] = await Promise.all([
		client.reading
			.read({ kind: "comic", ref: { id: read.chapter.comicId } })
			.catch(() => null),
		client.reading.me().catch(() => null),
	]);

	return {
		chapter: read.chapter,
		pages: read.pages,
		comic: comicRead?.kind === "comic" ? comicRead.comic : null,
		chapters: comicRead?.kind === "comic" ? comicRead.chapters : [],
		signedIn: Boolean(me?.signedIn),
	};
};
