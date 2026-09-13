import { createAuth as createConfiguredAuth } from "@comic/auth";
import { createPrismaClient, type Database } from "@comic/db";
import { createDiskStorage } from "@comic/storage";

import { env } from "./env.server";

const db = createPrismaClient(env);

export function getDb(): Database {
	return db;
}

export const storage = createDiskStorage(env.STORAGE_DIR);
export const auth = createConfiguredAuth(env, db);
