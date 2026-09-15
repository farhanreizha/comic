/**
 * E2E smoke for admin user suspend (decision #5, issue #7): admin suspends a
 * creator → sign-in is rejected, the EXISTING session drops to anonymous on
 * the next request, upload is blocked → non-admin suspend attempt is 403 →
 * unsuspend restores the session's power. Boots the real Hono app + real
 * Postgres. Run from apps/server/:
 *   bun e2e-suspend.ts
 */

import { createPrismaClient } from "@comic/db";
import { env } from "./src/env.server";
import { app } from "./src/index";
import { auth } from "./src/services";

const db = createPrismaClient(env);

const assert = (cond: unknown, msg: string): void => {
	if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
	console.log(`ok — ${msg}`);
};

const PASSWORD = "e2e-password-123";

const rpcFor = (cookie: string) => async (path: string, input: unknown) => {
	const res = await app.request(`http://localhost/rpc${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", cookie },
		body: JSON.stringify({ json: input }),
	});
	return { status: res.status, text: await res.text() };
};

const signUp = async (
	name: string,
): Promise<{ cookie: string; id: string; email: string }> => {
	const email = `e2e-sus-${name.toLowerCase().replace(/ /g, "-")}-${Date.now()}@example.com`;
	const res = await auth.handler(
		new Request("http://localhost/api/auth/sign-up/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password: PASSWORD, name }),
		}),
	);
	const cookie: string = res.headers.get("set-cookie") ?? "";
	if (!cookie) throw new Error(`no session cookie from sign-up ${name}`);
	const user = await db.user.findUniqueOrThrow({ where: { email } });
	return { cookie, id: user.id, email };
};

const signIn = async (email: string) =>
	auth.handler(
		new Request("http://localhost/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password: PASSWORD }),
		}),
	);

/* ------------------------------------------------------------------ setup */

await db.user.deleteMany({
	where: { name: { in: ["E2E Sus Admin", "E2E Sus Creator"] } },
});

const admin = await signUp("Sus Admin");
await db.user.update({ where: { id: admin.id }, data: { role: "admin" } });
const creator = await signUp("Sus Creator");
await db.user.update({ where: { id: creator.id }, data: { role: "creator" } });
const adminRpc = rpcFor(admin.cookie);
const creatorRpc = rpcFor(creator.cookie);
console.log("sessions: admin + creator ready");

/* 1. non-admin cannot suspend — router role guard */
const forbidden = await creatorRpc("/admin/suspendUser", { userId: admin.id });
assert(forbidden.status === 403, "creator calling suspendUser → 403");

/* 2. admin suspends the creator */
const sus = await adminRpc("/admin/suspendUser", {
	userId: creator.id,
	reason: "policy violation",
});
assert(sus.status === 200, "admin suspendUser → 200");
const row = await db.user.findUniqueOrThrow({ where: { id: creator.id } });
assert(
	row.suspendedAt !== null &&
		row.suspendReason === "policy violation" &&
		row.role === "creator",
	"suspendedAt + reason set; role untouched",
);

/* 3. re-suspend → CONFLICT; self-suspend refused; unknown → NOT_FOUND */
const again = await adminRpc("/admin/suspendUser", { userId: creator.id });
assert(again.status === 409, "second suspendUser → 409 CONFLICT");
const self = await adminRpc("/admin/suspendUser", { userId: admin.id });
assert(self.status === 400, "self-suspend → 400 INVALID_INPUT (lockout guard)");
const ghost = await adminRpc("/admin/suspendUser", { userId: "nope" });
assert(ghost.status === 404, "suspend unknown user → 404");

/* 4. the EXISTING session drops to anonymous on the next request */
const me = await creatorRpc("/reading/me", {});
assert(
	me.status === 200 && me.text.includes('"signedIn":false'),
	"suspended creator's old session resolves as signedOut (viewer demoted)",
);
const upload = await creatorRpc("/publishing/createComic", {
	title: "suspended draft",
	slug: "suspended-draft-e2e",
	visibility: "private",
});
assert(
	upload.status === 401,
	"upload path with the old session → 401 (viewer is anonymous)",
);

/* 5. sign-in is blocked while suspended */
const denied = await signIn(creator.email);
assert(
	denied.status === 403,
	"sign-in for a suspended user → 403 account suspended",
);

/* 6. unsuspend restores the same session cookie */
const uns = await adminRpc("/admin/unsuspendUser", { userId: creator.id });
assert(uns.status === 200, "admin unsuspendUser → 200");
const meBack = await creatorRpc("/reading/me", {});
assert(
	meBack.status === 200 && meBack.text.includes('"role":"creator"'),
	"after unsuspend the session is the creator again (no re-login)",
);
const unsAgain = await adminRpc("/admin/unsuspendUser", { userId: creator.id });
assert(unsAgain.status === 409, "unsuspend an active user → 409 CONFLICT");
const canSignIn = await signIn(creator.email);
assert(canSignIn.status === 200, "sign-in works again after unsuspend");

console.log("E2E SUSPEND OK");
await db.$disconnect();
process.exit(0);
