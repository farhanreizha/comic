import type { Database } from "@comic/db";
import { APIError, betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

export type AuthConfig = {
	BETTER_AUTH_URL: string;
	BETTER_AUTH_SECRET: string;
	CORS_ORIGIN: string;
};

/**
 * Moderation (decision #5): a suspended user gets no new session. Exported
 * for testing; thrown into better-auth's session-create hook, a thrown
 * APIError surfaces as the sign-in failure. Existing sessions die at the
 * request gate (viewerWithRole demotes them to anonymous) — no session
 * purge needed; unsuspend takes effect on the next request either way.
 */
export function sessionCreateGuard(database: Database) {
	return {
		async before(session: { userId?: string }) {
			if (!session.userId) return true;
			const user = await database.user.findUnique({
				where: { id: session.userId },
				select: { suspendedAt: true },
			});
			if (user?.suspendedAt) {
				throw new APIError("FORBIDDEN", { message: "account suspended" });
			}
			return true;
		},
	};
}

export function createAuth(
	env: AuthConfig,
	database: Database,
	desktopOrigins: readonly string[] = [],
) {
	return betterAuth({
		database: prismaAdapter(database, {
			provider: "postgresql",
		}),
		trustedOrigins: [env.CORS_ORIGIN, ...desktopOrigins],
		emailAndPassword: { enabled: true },
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		databaseHooks: { session: { create: sessionCreateGuard(database) } },
		advanced: {
			defaultCookieAttributes: {
				sameSite: "none",
				secure: true,
				httpOnly: true,
			},
		},
		plugins: [],
	});
}
