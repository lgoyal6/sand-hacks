// "Rewrite race" card data (owner: B). Presentation-agnostic: D's card renders this JSON.
// Lanes come from the variant experiments on Neon main; whether each lane's branch still exists
// comes from the live Neon branch list. Rejected branches are pruned (Neon caps branch count),
// so `branchLive: false` on a loser is expected and its record lives on in main.
import type { SolveRate, VariantExperiment, VariantStrategy } from "@unprompted/shared";

export type CheckState = { state: "passed" | "failed" | "pending" | "skipped"; detail?: string };

export interface RaceLane {
  id: string;
  version: number;
  label: string; // "Version 3 · new numbers"
  branch: string; // exp/<item>/<k>
  branchLive: boolean;
  status: VariantExperiment["status"];
  stem: string;
  checks: {
    sameAnswer: CheckState; // solver reproduced the key 3/3
    sameSkill: CheckState; // judge panel: same objective and unambiguous
    notOnline: CheckState; // leak check on the rewritten stem (passed = not found online)
    /** Information only, never a pass/fail: how often isolated agents solved this version. */
    agentSolveRate: { measured: boolean; correct?: number; runs?: number; ci95?: [number, number]; note?: string };
  };
  reason?: string;
}

export interface RaceData {
  itemId: string;
  title: string; // "4 versions raced. 1 made it."
  note: string;
  lanes: RaceLane[];
  survivor: { id: string; stem: string; agents?: string; was?: string; status: VariantExperiment["status"] } | null;
  baseline: { correct: number; runs: number; model: string } | null;
  neon: { source: "neon-api" | "unavailable"; experimentBranches: string[] };
}

const STRATEGY: Record<VariantStrategy, string> = {
  isomorphic: "new numbers",
  application: "real-world setting",
  find_error: "find the error",
  figure_dependency: "table lookup",
  counterfactual: "what-if",
};

function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

function check(v: boolean | undefined, status: VariantExperiment["status"], failDetail?: string): CheckState {
  if (v === true) return { state: "passed" };
  if (v === false) return { state: "failed", detail: failDetail };
  return { state: status === "proposed" ? "pending" : "skipped" };
}

export function buildRace(itemId: string, experiments: VariantExperiment[], branches: string[] | null, baseline: SolveRate & { model: string } | null): RaceData {
  const exps = experiments.filter((e) => e.itemId === itemId).sort((a, b) => num(a.id) - num(b.id));
  const lanes: RaceLane[] = exps.map((e) => {
    const k = num(e.id);
    const last = e.reasons.at(-1);
    const failedAt = e.checks.answerKeyConsistent === false ? "answer" : e.checks.objectivePreserved === false || e.checks.unambiguous === false ? "skill" : "other";
    const r = e.checks.newSolveRate;
    const agents = parseAgents(e.reasons);
    return {
      id: e.id,
      version: k,
      label: `Version ${k} · ${STRATEGY[e.strategy] ?? e.strategy}`,
      branch: e.neonBranch,
      branchLive: branches?.includes(e.neonBranch) ?? false,
      status: e.status,
      stem: e.candidate.stem,
      checks: {
        sameAnswer: check(e.checks.answerKeyConsistent, e.status, failedAt === "answer" ? last : undefined),
        sameSkill: check(
          e.checks.objectivePreserved === undefined ? undefined : e.checks.objectivePreserved && e.checks.unambiguous !== false,
          e.status,
          failedAt === "skill" ? last : undefined,
        ),
        // Only a decided version has an agent verdict. A "proposed" one (including a retake with no
        // valid runs, which may still carry newSolveRate 0 of 0) is unmeasured, never "failed".
        notOnline:
          e.checks.leakFree === true
            ? { state: "passed" }
            : e.checks.leakFree === false
              ? { state: "failed", detail: `found on ${(e.checks.leakSources ?? []).join(", ") || "the web"}` }
              : { state: e.status === "rejected" ? "skipped" : "pending", detail: e.reasons.find((x) => x.startsWith("leak check unavailable")) },
        agentSolveRate:
          r !== undefined && agents
            ? { measured: true, correct: agents.correct, runs: agents.runs, ci95: wilson(agents.correct, agents.runs) }
            : { measured: false, note: e.reasons.find((x) => /agent solve rate not measured|retake/.test(x)) },
      },
      reason: last,
    };
  });
  const winners = lanes.filter((l) => l.status === "verified" || l.status === "approved");
  const w = winners[0];
  const wAgents = w ? parseAgents(exps.find((e) => e.id === w.id)!.reasons) : null;
  return {
    itemId,
    title: `${lanes.length} version${lanes.length === 1 ? "" : "s"} raced. ${winners.length} ready (same answer, same skill, not online).`,
    note: "Each version runs on its own Neon database branch. A version is kept when it reproduces its answer key, tests the same skill, and isn't already online. The agent solve rate is shown for information.",
    lanes,
    survivor: w
      ? {
          id: w.id,
          stem: w.stem,
          status: w.status,
          agents: wAgents ? `${wAgents.correct}/${wAgents.runs}` : undefined,
          was: baseline ? `${baseline.correct}/${baseline.runs}` : undefined,
        }
      : null,
    baseline: baseline ? { correct: baseline.correct, runs: baseline.runs, model: baseline.model } : null,
    neon: { source: branches ? "neon-api" : "unavailable", experimentBranches: (branches ?? []).filter((b) => b.startsWith(`exp/${itemId}/`)) },
  };
}

function num(id: string) {
  return Number(id.match(/-v(\d+)$/)?.[1] ?? 0);
}

/** "... 0/5 valid agent runs ..." -> counts, from the decide() reason text. */
function parseAgents(reasons: string[]): { correct: number; runs: number } | null {
  for (let i = reasons.length - 1; i >= 0; i--) {
    const m = reasons[i]!.match(/(\d+)\/(\d+) (?:valid )?(?:isolated )?agent runs|agent solve rate (\d+)\/(\d+) valid runs/);
    if (m && m[3]) return { correct: Number(m[3]), runs: Number(m[4]) };
    if (m) return { correct: Number(m[1]), runs: Number(m[2]) };
  }
  return null;
}
