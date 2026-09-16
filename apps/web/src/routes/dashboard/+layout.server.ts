import { redirect } from "@sveltejs/kit";
import { serverClient } from "$lib/orpc.server";
import type { LayoutServerLoad } from "./$types";

/**
 * The gate is the load (server), same doctrine as /admin and /upload: a
 * client-side check is not a gate. Anonymous and readers never see dashboard
 * chrome — /creator/apply itself renders the sign-in prompt for anonymous.
 * `viewSiteHref` is the smart "View Site" target, resolved server-side
 * because the comic slug for ?comic={id} needs a data read.
 */
export const load: LayoutServerLoad = async ({ cookies, url }) => {
	const client = serverClient(cookies);
	const me = await client.reading.me().catch(() => null);
	if (!me?.signedIn || me.role === "reader" || me.role === null) {
		redirect(302, "/creator/apply");
	}

	let viewSiteHref = "/";
	if (url.pathname.startsWith("/dashboard/comics")) {
		viewSiteHref = "/library";
	} else if (url.pathname.startsWith("/dashboard/upload")) {
		const comicId = url.searchParams.get("comic");
		if (comicId) {
			// Owner can read own drafts/unlisted, so the slug resolves; a bad or
			// foreign id just falls back to the home link.
			const read = await client.reading
				.read({ kind: "comic", ref: { id: comicId } })
				.catch(() => null);
			if (read && read.kind === "comic") viewSiteHref = `/comic/${read.comic.slug}`;
		}
	}

	return { role: me.role, signedIn: true, viewSiteHref };
};
