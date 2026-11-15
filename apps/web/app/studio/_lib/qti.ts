// Runs the workflows QTI CLI (owner: B). apps/web can't import services/workflows, so it spawns it.
import "server-only";
import { spawnWorkflow } from "@/lib/workflows";

export function runQti(args: string[]) {
  return runWorkflows("qti", args);
}

/** Any workflows package script; the last JSON line of its output is the result. */
export function runWorkflows(script: "qti" | "leakscan", args: string[], timeoutMs = 5 * 60_000): Promise<{ code: number | null; json: unknown; out: string }> {
  return new Promise((resolve) => {
    const child = spawnWorkflow(script, args);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      clearTimeout(timer);
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
