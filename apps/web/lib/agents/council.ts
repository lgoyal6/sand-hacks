// Grade a finished think-aloud probe with the council (three Gemini models; owner: B).
// Fire-and-forget: the student's request never waits on it, and never fails because of it. The council writes
// probe.council_scores_json and probe.final_score; professor_approved stays false until a professor clicks.
import "server-only";
import { spawnWorkflow } from "@/lib/workflows";

export function gradeProbeAsync(probeId: string): void {
  if (!/^[\w-]+$/.test(probeId)) return;
  try {
    const child = spawnWorkflow("council", [probeId], { detached: true, stdio: "ignore" });
    child.on("error", (e) => console.error(`[council] could not start for ${probeId}:`, e.message));
    child.unref();
  } catch (e) {
    console.error(`[council] could not start for ${probeId}:`, (e as Error).message);
  }
}
