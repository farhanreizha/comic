/**
 * ChapterFilesPort over the storage module — put/delete only. The storage key
 * guard stays the second line of defence behind the module's own minting.
 */

import type { StorageAdapter } from "@comic/storage";
import type { ChapterFilesPort } from "../types";

export function createChapterFilesPort(
	storage: StorageAdapter,
): ChapterFilesPort {
	return {
		async put(key, file) {
			await storage.put(key, file);
		},
		async delete(key) {
			await storage.delete(key);
		},
	};
}
