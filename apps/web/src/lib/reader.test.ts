import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { activeWindow } from "./reader";

describe("activeWindow", () => {
	test("centered window", () => {
		assert.deepEqual(activeWindow(10, 100, 5), [5, 15]);
	});
	test("clamps at the start", () => {
		assert.deepEqual(activeWindow(2, 100, 5), [1, 7]);
	});
	test("clamps at the end", () => {
		assert.deepEqual(activeWindow(99, 100, 5), [94, 100]);
	});
	test("single-page chapter", () => {
		assert.deepEqual(activeWindow(1, 1, 5), [1, 1]);
	});
});
