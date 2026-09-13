import { createAuth as createConfiguredAuth } from "@comic/auth";
import { type Database, createPrismaClient } from "@comic/db";

import { env } from "./env.server";

const db = createPrismaClient(env);

export function getDb(): Database {
  return db;
}
export const auth = createConfiguredAuth(env, db);
