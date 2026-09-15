import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDiskStorage, createMemoryStorage } from "./index";

const bytes = new Uint8Array([1, 2, 3]);
const file = { bytes, contentType: "image/png" };

describe("list(prefix)", () => {
	test("memory: returns sorted keys under prefix, excludes sidecars-irrelevant keys", async () => {
		const s = createMemoryStorage();
		await s.put("comics/a/chapters/c1/1.png", file);
		await s.put("comics/b/chapters/c2/1.png", file);
		await s.put("applications/x/sample", file);
		expect(await s.list("comics/")).toEqual([
			"comics/a/chapters/c1/1.png",
			"comics/b/chapters/c2/1.png",
		]);
		expect((await s.list("")).length).toBe(3);
		expect(await s.list("missing/")).toEqual([]);
	});

	const dir = mkdtempSync(join(tmpdir(), "storage-test-"));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	test("disk: enumerates nested keys, hides .meta.json sidecars", async () => {
		const s = createDiskStorage(dir);
		await s.put("comics/a/chapters/c1/1.png", file);
		await s.put("comics/a/chapters/c1/2.png", file);
		await s.put("other/1.jpg", file);
		expect(await s.list("comics/")).toEqual([
			"comics/a/chapters/c1/1.png",
			"comics/a/chapters/c1/2.png",
		]);
		expect(await s.list("")).toEqual([
			"comics/a/chapters/c1/1.png",
			"comics/a/chapters/c1/2.png",
			"other/1.jpg",
		]);
		// deleted keys disappear
		await s.delete("other/1.jpg");
		expect(await s.list("other")).toEqual([]);
	});

	test("list rejects traversal prefixes", async () => {
		const s = createDiskStorage(dir);
		await expect(s.list("../")).rejects.toThrow("invalid storage prefix");
	});
});
