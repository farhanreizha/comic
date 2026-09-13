import type { createAuth } from "@comic/auth";
import type { Database } from "@comic/db";
import type { Viewer } from "@comic/reading";
import type { StorageAdapter } from "@comic/storage";

export type Context = {
	auth: null;
	session: Awaited<
		ReturnType<ReturnType<typeof createAuth>["api"]["getSession"]>
	>;
	db: Database;
	storage: StorageAdapter;
	/** Viewer derived from the session — anonymous is a value, not an absence. */
	viewer: Viewer;
};
