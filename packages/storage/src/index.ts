export type StoredFile = {
	readonly bytes: Uint8Array;
	readonly contentType: string;
};

export type StorageAdapter = {
	put(key: string, value: StoredFile): Promise<void>;
	get(key: string): Promise<StoredFile | null>;
	delete(key: string): Promise<void>;
};

const assertSafeKey = (key: string): void => {
	if (
		key.length === 0 ||
		key.startsWith("/") ||
		key.includes("\\") ||
		key
			.split("/")
			.some((segment) => segment === ".." || segment === "." || segment === "")
	) {
		throw new Error(`invalid storage key: ${key}`);
	}
};

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array): string => new TextDecoder().decode(b);

/** Local-disk adapter. Files live under `rootDir`, metadata in a `.json` sidecar. */
export function createDiskStorage(rootDir: string): StorageAdapter {
	return {
		async put(key, value) {
			assertSafeKey(key);
			const { mkdir, writeFile } = await import("node:fs/promises");
			const path = await import("node:path");
			const target = path.join(rootDir, key);
			await mkdir(path.dirname(target), { recursive: true });
			await writeFile(target, value.bytes);
			await writeFile(
				`${target}.meta.json`,
				utf8(JSON.stringify({ contentType: value.contentType })),
			);
		},
		async get(key) {
			assertSafeKey(key);
			const { readFile } = await import("node:fs/promises");
			const path = await import("node:path");
			const target = path.join(rootDir, key);
			try {
				const [bytes, meta] = await Promise.all([
					readFile(target),
					readFile(`${target}.meta.json`).catch(() => null),
				]);
				const contentType = meta
					? ((JSON.parse(fromUtf8(meta)) as { contentType?: string })
							.contentType ?? "application/octet-stream")
					: "application/octet-stream";
				return { bytes: new Uint8Array(bytes), contentType };
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw error;
			}
		},
		async delete(key) {
			assertSafeKey(key);
			const { rm } = await import("node:fs/promises");
			const path = await import("node:path");
			const target = path.join(rootDir, key);
			await rm(target, { force: true });
			await rm(`${target}.meta.json`, { force: true });
		},
	};
}

/** In-memory adapter for tests. */
export function createMemoryStorage(): StorageAdapter & {
	clear(): void;
	size(): number;
} {
	const files = new Map<string, StoredFile>();
	return {
		async put(key, value) {
			assertSafeKey(key);
			files.set(key, {
				bytes: value.bytes.slice(),
				contentType: value.contentType,
			});
		},
		async get(key) {
			assertSafeKey(key);
			const found = files.get(key);
			return found
				? { bytes: found.bytes.slice(), contentType: found.contentType }
				: null;
		},
		async delete(key) {
			assertSafeKey(key);
			files.delete(key);
		},
		clear() {
			files.clear();
		},
		size() {
			return files.size;
		},
	};
}
