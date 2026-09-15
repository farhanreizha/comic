/**
 * sessionCreateGuard unit test — the sign-in half of user suspend
 * (decision #5). The request half lives in apps/server's viewerWithRole.
 */
import { describe, expect, test } from "bun:test";
import { sessionCreateGuard } from "./index";

const fakeDb = (suspendedAt: Date | null) =>
	({
		user: {
			findUnique: async () => ({ suspendedAt }),
		},
	}) as never;

describe("sessionCreateGuard", () => {
	test("active user: session creation proceeds", async () => {
		expect(
			await sessionCreateGuard(fakeDb(null)).before({ userId: "u1" }),
		).toBe(true);
	});

	test("suspended user: session creation is rejected", async () => {
		const thrown = await sessionCreateGuard(fakeDb(new Date("2026-01-01")))
			.before({ userId: "u1" })
			.then(() => null)
			.catch(
				(error: unknown) =>
					error as { status?: unknown; body?: { message?: string } },
			);
		expect(thrown).not.toBeNull();
		// better-auth keeps the literal status it was constructed with.
		expect(String(thrown?.status)).toContain("FORBIDDEN");
		expect(thrown?.body?.message).toBe("account suspended");
	});
});
