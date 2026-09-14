import { serverClient } from "$lib/orpc.server";
import type { PageServerLoad } from "./$types";

/** Gate in the load: anonymous → prompt; creator/admin → already-creator
 * state; reader → form + latest application status if one exists. */
export const load: PageServerLoad = async ({ cookies }) => {
	const client = serverClient(cookies);
	const me = await client.reading.me().catch(() => null);
	if (!me?.signedIn) return { gate: "anonymous" as const, application: null };
	if (me.role === "creator" || me.role === "admin") {
		return { gate: "creator" as const, application: null };
	}
	const application = await client.admin.myApplication().catch(() => null);
	return { gate: "reader" as const, application };
};
