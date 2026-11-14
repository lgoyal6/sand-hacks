// A minimal SQL handle that both Neon and the local PGlite fallback satisfy.
export interface Db {
  /** Parameterised single statement. */
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Multi-statement script, no parameters (schema files). */
  exec(sql: string): Promise<void>;
}

export interface BranchHandle {
  name: string;
  id: string;
  db: Db;
}

/**
 * Copy-on-write branches of the app database. "main" is the trunk.
 * Neon has no native merge, so survivors are merged by upserting rows
 * into main (see merge.ts); experiment branches are kept for audit.
 */
export interface BranchStore {
  readonly kind: "neon" | "pglite";
  main(): Promise<BranchHandle>;
  /** Create `name` from `parent` (default main). Fails if it already exists. */
  createBranch(name: string, parent?: string): Promise<BranchHandle>;
  /** Open an existing branch. */
  branch(name: string): Promise<BranchHandle>;
  listBranches(): Promise<string[]>;
  deleteBranch(name: string): Promise<void>;
  close(): Promise<void>;
}
