import { serverClient } from "$lib/orpc.server";
import type { PageServerLoad } from "./$types";

/**
 * Role gate lives in the LOAD (server), not the component: a client-side
 * check is not a gate. Anonymous → sign-in prompt state; reader → application
 * CTA; creator/admin → the form, seeded with the viewer's own comics.
 */
export const load: PageServerLoad = async ({ cookies }) => {
	const client = serverClient(cookies);
	const me = await client.reading.me().catch(() => null);
	if (!me?.signedIn) {
		return { gate: "anonymous" as const, comics: [] };
	}
	if (me.role !== "creator" && me.role !== "admin") {
		const application = await client.admin.myApplication().catch(() => null);
		return {
			gate: "reader" as const,
			comics: [],
			applicationStatus: application?.status ?? null,
		};
	}
	// browse with the creator's scope returns own comics plus everyone's
	// public ones — own = the cards whose creator matches me.id.
	const page = await client.reading.browse({ limit: 100 }).catch(() => null);
	const mine = (page?.items ?? []).filter((c) => c.creator.id === me.id);
	return { gate: "creator" as const, comics: mine };
};
