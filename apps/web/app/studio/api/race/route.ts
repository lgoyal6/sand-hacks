// GET /studio/api/race?item=sample-stats-q1  ->  RaceData (owner: B)
// Experiments from Neon main, the live branch list from the Neon API, and the same-model baseline.
import path from "node:path";
import type { AgentRun } from "@unprompted/shared";
import { FIXTURES_DIR, readJson } from "@/lib/db/fixtures";
import { getStudioData } from "../../_lib/data";
import { buildRace } from "../../_lib/race";

const ATTACK_MODEL = process.env.ATTACK_MODELS?.trim() || "gmi:google/gemini-3.8-flash";

async function neonBranches(): Promise<string[] | null> {
  const key = process.env.NEON_API_KEY?.trim();
  const project = process.env.NEON_PROJECT_ID?.trim();
  if (!key || !project) return null;
  try {
    const r = await fetch(`https://console.neon.tech/api/v2/projects/${project}/branches`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const body = (await r.json()) as { branches: { name: string }[] };
    return body.branches.map((b) => b.name);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const itemId = new URL(req.url).searchParams.get("item") ?? "";
  if (!/^[\w-]+-q\d+$/.test(itemId)) return Response.json({ error: "item must look like <quizId>-q<n>" }, { status: 400 });
  const quizId = itemId.replace(/-q\d+$/, "");
  const [data, branches, runs] = await Promise.all([
    getStudioData(quizId),
    neonBranches(),
    readJson<AgentRun[]>(path.join(FIXTURES_DIR, "agent_runs.json"), []),
  ]);
  const same = runs.filter((r) => r.itemId === itemId && r.model === ATTACK_MODEL);
  const baseline = same.length
    ? { itemId, runs: same.length, correct: same.filter((r) => r.correct).length, solveRate: 0, agentSolvable: true, model: ATTACK_MODEL }
    : null;
  return Response.json(buildRace(itemId, data.experiments, branches, baseline));
}
