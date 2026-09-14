import type { Handle } from "@sveltejs/kit";
import type { Locale } from "$paraglide/runtime.js";
import { paraglideMiddleware } from "$paraglide/server.js";

// Locale comes from the PARAGLIDE_LOCALE cookie (no locale prefix in URLs).
// The incoming `event.request` is forwarded untouched — this app never
// localizes URLs, so the middleware's delocalization step is a no-op.
export const handle: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ locale }: { locale: Locale }) => {
		event.locals.locale = locale;
		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html.replace('lang="id"', `lang="${locale}"`),
		});
	});
