import { serverClient } from "$lib/orpc.server";
import type { PageServerLoad } from "./$types";

/**
 * The gate is the load: role is resolved server-side from the session, and a
 * non-admin gets an explicit "denied" state rendered as a page — not a blank
 * screen, not a 500, and not a check the client could skip.
 */
export const load: PageServerLoad = async ({ cookies }) => {
	const client = serverClient(cookies);
	const me = await client.reading.me().catch(() => null);
	if (me?.role !== "admin") {
		return { gate: "denied" as const };
	}
	const [applications, reports, comics] = await Promise.all([
		client.admin.listApplications({ status: "pending" }).catch(() => null),
		client.admin.listReports({ status: "open" }).catch(() => null),
		// Admin browse scope is `all` — this is every comic on the platform.
		client.reading.browse({ limit: 100 }).catch(() => null),
	]);
	return {
		gate: "admin" as const,
		applications: applications?.items ?? null,
		reports: reports?.items ?? null,
		comics: comics?.items ?? null,
	};
};
