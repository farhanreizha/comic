/**
 * SampleFilesPort over the storage module — the same mapping production uses.
 * The admin module never touches a filesystem path (invariant 13).
 */

import type { StorageAdapter } from "@comic/storage";
import type { SampleFilesPort } from "../types";

export function createStorageSamplePort(
	storage: StorageAdapter,
): SampleFilesPort {
	return {
		async put(key, file) {
			await storage.put(key, file);
		},
	};
}
