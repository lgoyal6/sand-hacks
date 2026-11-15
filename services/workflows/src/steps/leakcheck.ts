// D's leak scan run out of process (keeps @unprompted/leakscan out of the Mastra bundle).
// Used by the Leak scout agent and by the rewrite pipeline's leak check.
import { spawn } from "node:child_process";
import path from "node:path";
import type { LeakFinding } from "@unprompted/shared";
import { REPO_ROOT } from "../paths.js";

export type ItemScan = { itemId: string; findings: LeakFinding[]; queries: { error?: string }[] };

export function runLeakScan(items: { id: string; stem: string }[], opts: { windows?: number; fuzzy?: boolean; threshold?: number } = {}): Promise<ItemScan[]> {
  return new Promise((resolve, reject) => {
    const cwd = path.join(REPO_ROOT, "services/workflows");
    const child = spawn("npx", ["tsx", "--env-file-if-exists=../../.env.local", "scripts/leakscan-json.ts"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 5 * 60_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`leak scan failed (${code}): ${err.trim().split("\n").at(-1) ?? ""}`));
      try {
        resolve((JSON.parse(out) as { scans: ItemScan[] }).scans);
      } catch {
        reject(new Error("leak scan output was not JSON"));
      }
    });
    child.stdin.end(JSON.stringify({ items, ...opts }));
  });
}

export interface LeakCheckResult {
  leakFree: boolean;
  sources: string[];
  queries: number;
  queryErrors: number;
}

/** Leak check for one rewritten stem: exact-phrase windows only, at most 2 SERP calls. */
export interface LeakChecker {
  check(stem: string, id: string): Promise<LeakCheckResult>;
}

export class SerpLeakChecker implements LeakChecker {
  async check(stem: string, id: string): Promise<LeakCheckResult> {
    const [scan] = await runLeakScan([{ id, stem }], { windows: 2, fuzzy: false });
    const findings = scan?.findings ?? [];
    const queries = scan?.queries ?? [];
    const hosts = [...new Set(findings.map((f) => { try { return new URL(f.url).hostname.replace(/^www\./, ""); } catch { return f.url; } }))];
    if (queries.length && queries.every((q) => q.error)) throw new Error("leak check unavailable: every search failed");
    return { leakFree: findings.length === 0, sources: hosts, queries: queries.length, queryErrors: queries.filter((q) => q.error).length };
  }
}
