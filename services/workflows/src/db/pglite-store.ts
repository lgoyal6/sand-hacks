import { PGlite, type PGliteInterface } from "@electric-sql/pglite";
import type { BranchHandle, BranchStore, Db } from "./types.js";

function wrap(pg: PGliteInterface): Db {
  return {
    async query<T>(text: string, params?: unknown[]) {
      const r = await pg.query<T>(text, params as any[]);
      return { rows: r.rows };
    },
    async exec(sql: string) {
      await pg.exec(sql);
    },
  };
}

/**
 * Local fallback for when Neon keys are missing. Each branch is an in-memory
 * PGlite instance cloned from its parent, which gives the same
 * copy-at-branch-time semantics as Neon.
 */
export class PGliteBranchStore implements BranchStore {
  readonly kind = "pglite" as const;
  private branches = new Map<string, PGliteInterface>();

  private constructor(main: PGliteInterface) {
    this.branches.set("main", main);
  }

  static async create(schemaSql?: string): Promise<PGliteBranchStore> {
    const main = new PGlite();
    if (schemaSql) await main.exec(schemaSql);
    return new PGliteBranchStore(main);
  }

  private handle(name: string): BranchHandle {
    const pg = this.branches.get(name);
    if (!pg) throw new Error(`branch not found: ${name}`);
    return { name, id: name, db: wrap(pg) };
  }

  async main() {
    return this.handle("main");
  }

  async createBranch(name: string, parent = "main") {
    if (this.branches.has(name)) throw new Error(`branch already exists: ${name}`);
    const src = this.branches.get(parent);
    if (!src) throw new Error(`parent branch not found: ${parent}`);
    this.branches.set(name, await src.clone());
    return this.handle(name);
  }

  async branch(name: string) {
    return this.handle(name);
  }

  async listBranches() {
    return [...this.branches.keys()];
  }

  async deleteBranch(name: string) {
    if (name === "main") throw new Error("refusing to delete main");
    const pg = this.branches.get(name);
    if (!pg) return;
    await pg.close();
    this.branches.delete(name);
  }

  async close() {
    for (const pg of this.branches.values()) await pg.close();
    this.branches.clear();
  }
}
