import { Pool, neonConfig } from "@neondatabase/serverless";
import type { BranchHandle, BranchStore, Db } from "./types.js";

// Node 22+ ships a global WebSocket; the serverless Pool needs one.
if (!neonConfig.webSocketConstructor && typeof WebSocket !== "undefined") {
  neonConfig.webSocketConstructor = WebSocket as any;
}

const API = "https://console.neon.tech/api/v2";

interface NeonBranch {
  id: string;
  name: string;
  default?: boolean;
  primary?: boolean;
}

function wrap(pool: Pool): Db {
  return {
    async query<T>(text: string, params?: unknown[]) {
      const r = await pool.query(text, params as any[]);
      return { rows: r.rows as T[] };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
  };
}

export interface NeonStoreOptions {
  apiKey: string;
  projectId: string;
  /** Connection string of the main (default) branch; used to learn role + database names. */
  mainUrl: string;
}

/** Real Neon branches via the Neon REST API. */
export class NeonBranchStore implements BranchStore {
  readonly kind = "neon" as const;
  private pools = new Map<string, Pool>();
  private roleName: string;
  private dbName: string;

  constructor(private opts: NeonStoreOptions) {
    const u = new URL(opts.mainUrl);
    this.roleName = decodeURIComponent(u.username);
    this.dbName = u.pathname.replace(/^\//, "") || "neondb";
  }

  static fromEnv(env = process.env): NeonBranchStore | null {
    const { NEON_API_KEY, NEON_PROJECT_ID, DATABASE_URL } = env;
    if (!NEON_API_KEY || !NEON_PROJECT_ID || !DATABASE_URL) return null;
    return new NeonBranchStore({ apiKey: NEON_API_KEY, projectId: NEON_PROJECT_ID, mainUrl: DATABASE_URL });
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}/projects/${this.opts.projectId}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Neon API ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  private async waitForOperations(ops: { id: string }[] = []) {
    for (const op of ops) {
      for (let i = 0; i < 120; i++) {
        const { operation } = await this.api<{ operation: { status: string } }>("GET", `/operations/${op.id}`);
        if (operation.status === "finished" || operation.status === "skipped") break;
        if (["failed", "cancelled", "error"].includes(operation.status)) {
          throw new Error(`Neon operation ${op.id} ${operation.status}`);
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  private async findBranch(name: string): Promise<NeonBranch | undefined> {
    const { branches } = await this.api<{ branches: NeonBranch[] }>("GET", "/branches");
    if (name === "main") return branches.find((b) => b.default || b.primary) ?? branches.find((b) => b.name === "main");
    return branches.find((b) => b.name === name);
  }

  private async connect(branch: NeonBranch, name: string): Promise<BranchHandle> {
    let pool = this.pools.get(branch.id);
    if (!pool) {
      const url =
        name === "main"
          ? this.opts.mainUrl
          : (
              await this.api<{ uri: string }>(
                "GET",
                `/connection_uri?branch_id=${branch.id}&database_name=${encodeURIComponent(this.dbName)}&role_name=${encodeURIComponent(this.roleName)}&pooled=true`,
              )
            ).uri;
      pool = new Pool({ connectionString: url });
      this.pools.set(branch.id, pool);
    }
    return { name, id: branch.id, db: wrap(pool) };
  }

  async main() {
    const b = await this.findBranch("main");
    if (!b) throw new Error("Neon project has no default branch");
    return this.connect(b, "main");
  }

  async createBranch(name: string, parent = "main") {
    if (await this.findBranch(name)) throw new Error(`branch already exists: ${name}`);
    const p = await this.findBranch(parent);
    if (!p) throw new Error(`parent branch not found: ${parent}`);
    const res = await this.api<{ branch: NeonBranch; operations: { id: string }[] }>("POST", "/branches", {
      branch: { name, parent_id: p.id },
      endpoints: [{ type: "read_write" }],
    });
    await this.waitForOperations(res.operations);
    return this.connect(res.branch, name);
  }

  async branch(name: string) {
    const b = await this.findBranch(name);
    if (!b) throw new Error(`branch not found: ${name}`);
    return this.connect(b, name);
  }

  async listBranches() {
    const { branches } = await this.api<{ branches: NeonBranch[] }>("GET", "/branches");
    return branches.map((b) => b.name);
  }

  async deleteBranch(name: string) {
    if (name === "main") throw new Error("refusing to delete main");
    const b = await this.findBranch(name);
    if (!b || b.default || b.primary) return;
    const pool = this.pools.get(b.id);
    if (pool) {
      await pool.end();
      this.pools.delete(b.id);
    }
    const res = await this.api<{ operations: { id: string }[] }>("DELETE", `/branches/${b.id}`);
    await this.waitForOperations(res.operations);
  }

  async close() {
    for (const p of this.pools.values()) await p.end();
    this.pools.clear();
  }
}
