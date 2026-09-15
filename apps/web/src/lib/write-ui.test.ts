import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { errorText, mapWriteError } from "./write-ui";

describe("mapWriteError", () => {
	test("known codes map to their specific message", () => {
		assert.notEqual(mapWriteError({ code: "FORBIDDEN" }).message, undefined);
		assert.match(mapWriteError({ code: "TOO_LARGE" }).message, /200 MB/);
	});
	test("BAD_REQUEST keeps the server validation text", () => {
		assert.equal(
			mapWriteError({ code: "BAD_REQUEST", message: "Title is required" })
				.message,
			"Title is required",
		);
	});
	test("unknown code with server message shows it (better-auth etc.)", () => {
		assert.equal(
			mapWriteError({
				code: "USER_NOT_FOUND",
				message: "Invalid email or password",
			}).message,
			"Invalid email or password",
		);
	});
	test("codeless plain-object body (better-auth shape) shows its message", () => {
		assert.equal(
			mapWriteError({ message: "Invalid email or password", status: 401 })
				.message,
			"Invalid email or password",
		);
	});
	test("codeless network error stays generic — never leaks raw Error text", () => {
		const msg = mapWriteError(new Error("Failed to fetch")).message;
		assert.notEqual(msg, "Failed to fetch");
		assert.ok(msg.length > 0);
	});
	test("errorText appends the server-set filename verbatim", () => {
		const mapped = mapWriteError({
			code: "TOO_LARGE",
			data: { filename: "big.cbz" },
		});
		assert.ok(mapped.message);
		assert.equal(errorText(mapped), `${mapped.message} (big.cbz)`);
	});
});
