export type StoredFile = {
	readonly bytes: Uint8Array;
	readonly contentType: string;
};

export type StorageAdapter = {
	put(key: string, value: StoredFile): Promise<void>;
	get(key: string): Promise<StoredFile | null>;
	delete(key: string): Promise<void>;
	/** Sorted keys of every stored object under `prefix` (`""` = all). */
	list(prefix: string): Promise<string[]>;
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

/** Prefixes are only ever used as filters — `..` segments are rejected so a
 * sweep can never look outside its root even if a future adapter resolves them. */
const assertSafePrefix = (prefix: string): void => {
	if (
		prefix.startsWith("/") ||
		prefix.includes("\\") ||
		prefix.split("/").some((segment) => segment === "..")
	) {
		throw new Error(`invalid storage prefix: ${prefix}`);
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
		async list(prefix) {
			assertSafePrefix(prefix);
			const { readdir } = await import("node:fs/promises");
			const path = await import("node:path");
			const walk = async (dir: string): Promise<string[]> => {
				const out: string[] = [];
				for (const entry of await readdir(dir, { withFileTypes: true })) {
					const full = path.join(dir, entry.name);
					if (entry.isDirectory()) out.push(...(await walk(full)));
					else if (entry.isFile() && !entry.name.endsWith(".meta.json"))
						out.push(path.relative(rootDir, full));
				}
				return out;
			};
			const keys = await walk(rootDir).catch((error) => {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
				throw error;
			});
			// Normalise platform separators to storage-key form.
			return keys
				.map((k) => k.split(path.sep).join("/"))
				.filter((k) => k.startsWith(prefix))
				.sort();
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
		async list(prefix) {
			assertSafePrefix(prefix);
			return [...files.keys()].filter((k) => k.startsWith(prefix)).sort();
		},
		clear() {
			files.clear();
		},
		size() {
			return files.size;
		},
	};
}
