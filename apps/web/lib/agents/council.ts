// Grade a finished think-aloud probe with the council (three Gemini models; owner: B).
// Fire-and-forget: the student's request never waits on it. The council writes
// probe.council_scores_json and probe.final_score; professor_approved stays false until a professor clicks.
import "server-only";
import { spawn } from "node:child_process";
import { REPO_ROOT } from "@/lib/db/fixtures";

export function gradeProbeAsync(probeId: string): void {
  if (!/^[\w-]+$/.test(probeId)) return;
  const child = spawn("pnpm", ["-s", "--filter", "@unprompted/workflows", "council", probeId], {
    cwd: REPO_ROOT,
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  child.on("error", (e) => console.error(`[council] could not start for ${probeId}:`, e.message));
  child.unref();
}
