// GET /studio/api/race?item=sample-stats-q1  ->  RaceData (owner: B)
// Experiments from Neon main, the live branch list from the Neon API, and the same-model baseline.
import path from "node:path";
import type { AgentRun } from "@unprompted/shared";
import { FIXTURES_DIR, readJson } from "@/lib/db/fixtures";
import { getStudioData } from "../../_lib/data";
import { buildRace } from "../../_lib/race";
import { consoleUrl, listBranches } from "../../_lib/neon-branches";
import { replayJson, withReplay } from "../../_lib/replay";

const ATTACK_MODEL = process.env.ATTACK_MODELS?.trim() || "gmi:google/gemini-3.8-flash";

export async function GET(req: Request) {
  const itemId = new URL(req.url).searchParams.get("item") ?? "";
  if (!/^[\w-]+-q\d+$/.test(itemId)) return Response.json({ error: "item must look like <quizId>-q<n>" }, { status: 400 });
  const quizId = itemId.replace(/-q\d+$/, "");
  try {
    return replayJson(
      await withReplay(req, "race", itemId, async () => {
        const [data, list, runs] = await Promise.all([getStudioData(quizId), listBranches({ maxAgeMs: 0 }), readJson<AgentRun[]>(path.join(FIXTURES_DIR, "agent_runs.json"), [])]);
        const branches = list ? list.branches.map((b) => b.name) : null;
        const same = runs.filter((r) => r.itemId === itemId && r.model === ATTACK_MODEL);
        const baseline = same.length ? { itemId, runs: same.length, correct: same.filter((r) => r.correct).length, solveRate: 0, agentSolvable: true, model: ATTACK_MODEL } : null;
        const race = buildRace(itemId, data.experiments, branches, baseline);
        // Neon facts per lane, only for branches the API lists right now.
        const byName = new Map((list?.branches ?? []).map((b) => [b.name, b]));
        race.lanes = race.lanes.map((l) => {
          const b = byName.get(l.branch);
          return b && list ? { ...l, branchId: b.id, consoleUrl: consoleUrl(list.projectId, b.id), parent: { name: b.parentName ?? "main", lsn: b.parentLsn } } : l;
        });
        return race;
      }),
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 503 });
  }
}
