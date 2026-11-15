// Automatic leak scan (owner: B). Fire-and-forget after import, publish and an approved rewrite: scans the
// quiz's delivered questions not scanned in the last 24 h (at most 2 searches each, cached) and saves new
// findings as unseen alerts. One scan per quiz at a time; failures are logged, never shown to the student path.
import "server-only";
import { spawnWorkflow } from "@/lib/workflows";

const g = globalThis as unknown as { __autoScans?: Set<string> };

export function autoScan(quizId: string, reason: string) {
  if (!/^[\w-]+$/.test(quizId)) return;
  if (!process.env.BRIGHTDATA_API_TOKEN?.trim()) return; // no Bright Data, no scan (never a fake result)
  const running = (g.__autoScans ??= new Set());
  if (running.has(quizId)) return;
  running.add(quizId);
  try {
    const child = spawnWorkflow("leakscan", [quizId, "--save", "--stale-only"]);
    child.stdin.end();
    let tail = "";
    child.stdout.on("data", (d) => (tail = (tail + d).slice(-4000)));
    child.stderr.on("data", (d) => (tail = (tail + d).slice(-4000)));
    const t = setTimeout(() => child.kill("SIGTERM"), 5 * 60_000);
    child.on("error", () => running.delete(quizId));
    child.on("close", (code) => {
      clearTimeout(t);
      running.delete(quizId);
      const line = tail.split("\n").filter((l) => l.startsWith("{")).at(-1);
      try {
        const j = JSON.parse(line ?? "") as { scanned: string[]; newFindings: number; queries: number };
        console.log(`[autoscan] ${quizId} (${reason}): ${j.scanned.length} scanned, ${j.queries} searches, ${j.newFindings} new findings`);
      } catch {
        console.warn(`[autoscan] ${quizId} (${reason}) failed (${code}): ${tail.trim().split("\n").at(-1) ?? ""}`);
      }
    });
  } catch (e) {
    running.delete(quizId);
    console.warn(`[autoscan] ${quizId}: ${(e as Error).message}`);
  }
}
