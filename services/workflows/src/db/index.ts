import { readFile } from "node:fs/promises";
import { NeonBranchStore } from "./neon-store.js";
import { PGliteBranchStore } from "./pglite-store.js";
import type { BranchStore } from "./types.js";

export * from "./types.js";
export * from "./merge.js";
export { NeonBranchStore, PGliteBranchStore };

import { SCHEMA_PATH } from "../paths.js";

export async function loadSchema(): Promise<string> {
  return readFile(SCHEMA_PATH, "utf8");
}

/**
 * Neon when NEON_API_KEY, NEON_PROJECT_ID and DATABASE_URL are set, otherwise
 * an in-memory PGlite store with the schema applied. Main gets the schema either way.
 */
export async function openBranchStore(env = process.env): Promise<BranchStore> {
  const schema = await loadSchema();
  const neon = NeonBranchStore.fromEnv(env);
  if (neon) {
    const main = await neon.main();
    await main.db.exec(schema);
    return neon;
  }
  return PGliteBranchStore.create(schema);
}
