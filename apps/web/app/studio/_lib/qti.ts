// Runs the workflows QTI CLI (owner: B). apps/web can't import services/workflows, so it spawns it.
import "server-only";
import { spawn } from "node:child_process";
import { REPO_ROOT } from "@/lib/db/fixtures";

export function runQti(args: string[]): Promise<{ code: number | null; json: unknown; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["-s", "--filter", "@unprompted/workflows", "qti", ...args], { cwd: REPO_ROOT, env: process.env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      const line = out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{")).at(-1);
      let json: unknown = null;
      try {
        json = line ? JSON.parse(line) : null;
      } catch {
        json = null;
      }
      resolve({ code, json, out });
    });
  });
}

/** The parser's own message, not the stack trace. */
export function qtiError(out: string) {
  return out.split("\n").map((l) => l.trim()).find((l) => /^Error: /.test(l))?.slice(7) ?? "unrecognized file";
}
