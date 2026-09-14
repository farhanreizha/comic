import type { AppRouterClient } from "@comic/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { ENV } from "../env";

/** Minimal structural type for SvelteKit's `event.cookies`. */
type IncomingCookies = {
	getAll(): { name: string; value: string }[];
};

/**
 * Server-side oRPC client that forwards the incoming request's cookies to the
 * API so `reading.me`/`shelf` and social reads resolve the real viewer during
 * SSR. The shared `$lib/orpc` client carries no cookies on server fetches.
 */
export function serverClient(cookies: IncomingCookies): AppRouterClient {
	const packed = cookies
		.getAll()
		.map((c) => `${c.name}=${c.value}`)
		.join("; ");
	const link = new RPCLink({
		url: `${ENV.PUBLIC_SERVER_URL.replace(/\/$/, "")}/rpc`,
		fetch: (url, options) =>
			fetch(url, {
				...options,
				headers: {
					...(options as RequestInit | undefined)?.headers,
					cookie: packed,
				},
			}),
	});
	return createORPCClient(link);
}
