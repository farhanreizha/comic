import type { StorageAdapter } from "@comic/storage";
import type { PageFilesPort } from "../types";

/** PageFilesPort over the storage module — the same mapping production uses, minus the disk. */
export function createStorageFilesPort(storage: StorageAdapter): PageFilesPort {
	return {
		async read(storageKey) {
			const found = await storage.get(storageKey);
			return found
				? { bytes: found.bytes, contentType: found.contentType }
				: null;
		},
	};
}
