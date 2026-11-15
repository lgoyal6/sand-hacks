// Experiment tree (owner: B): a git-style graph of one quiz's Neon branches.
// main runs down the left; each experiment branch exp/<item>/<k> forks off at its creation time;
// appeal branches (time travel) are short-lived side branches from appeal_log.
// Neon facts come only from the Neon API; anything it doesn't report is omitted, never estimated.
import "server-only";
import type { VariantExperiment } from "@unprompted/shared";
import { neon } from "@/lib/db/neon";

export interface NeonFacts {
  createdAt?: string;
  forkTimestamp?: string;
  forkLsn?: string;
  logicalSizeBytes?: number;
  /** Bytes written to the branch since it forked (Neon `written_data_bytes`). 0 = pure copy-on-write. */
  writtenBytes?: number;
}

export interface TreeLane {
  kind: "experiment" | "appeal";
  branch: string;
  label: string;
  at: string; // ISO time the branch forked (Neon if live, else our record)
  outcome: "approved" | "verified" | "rejected" | "not verified" | "appeal";
  reason?: string;
  live: boolean; // branch still exists on Neon
  merged: boolean; // its result was merged back into main
  neon?: NeonFacts;
  steps: string[];
  variantId?: string;
}

export interface TreeData {
  quizId: string;
  main: { branch: "main"; neon?: NeonFacts };
  lanes: TreeLane[];
  source: { neonApi: boolean; experiments: number; appeals: number };
}

interface NeonBranch {
  name: string;
  default?: boolean;
  primary?: boolean;
  created_at?: string;
  parent_lsn?: string;
  parent_timestamp?: string;
  logical_size?: number;
  written_data_bytes?: number;
}

async function neonBranches(): Promise<NeonBranch[] | null> {
  const key = process.env.NEON_API_KEY?.trim();
  const project = process.env.NEON_PROJECT_ID?.trim();
  if (!key || !project) return null;
  try {
    const r = await fetch(`https://console.neon.tech/api/v2/projects/${project}/branches`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    return r.ok ? ((await r.json()) as { branches: NeonBranch[] }).branches : null;
  } catch {
    return null;
  }
}

function facts(b: NeonBranch | undefined): NeonFacts | undefined {
  if (!b) return undefined;
  const f: NeonFacts = {};
  if (b.created_at) f.createdAt = b.created_at;
  if (b.parent_timestamp) f.forkTimestamp = b.parent_timestamp;
  if (b.parent_lsn) f.forkLsn = b.parent_lsn;
  if (typeof b.logical_size === "number") f.logicalSizeBytes = b.logical_size;
  if (typeof b.written_data_bytes === "number") f.writtenBytes = b.written_data_bytes;
  return f;
}

const STRATEGY: Record<string, string> = {
  isomorphic: "new numbers",
  application: "real-world setting",
  find_error: "find the error",
  figure_dependency: "figure only",
  counterfactual: "what-if",
};

function outcomeOf(e: VariantExperiment): TreeLane["outcome"] {
  return e.status === "proposed" ? "not verified" : e.status;
}

/** Short reason chip: the last reason, without prefixes and judge transcripts. */
function chip(reason?: string) {
  if (!reason) return undefined;
  const r = reason.replace(/^not verified:\s*/i, "").replace(/\s*\|.*$/, "").replace(/:\s*Gemini.*$/, "");
  return r.length > 80 ? `${r.slice(0, 79)}…` : r;
}

function stepsOf(e: VariantExperiment): string[] {
  const s = ["Branch created from main", "Variant written on the branch"];
  if (e.checks.answerKeyConsistent !== undefined) s.push(e.checks.answerKeyConsistent ? "Answer key reproduced 3/3 with code" : "Answer key not reproduced");
  if (e.checks.objectivePreserved !== undefined) s.push(e.checks.objectivePreserved && e.checks.unambiguous !== false ? "Judge panel: same skill, one clear answer" : "Judge panel: changed the skill or ambiguous");
  if (e.checks.newSolveRate !== undefined && e.status !== "proposed") s.push(`Agents retook it: solved ${Math.round(e.checks.newSolveRate * 100)}%`);
  s.push(e.status === "approved" ? "Approved and merged into the quiz" : e.status === "verified" ? "Merged to main, waiting for approval" : e.status === "rejected" ? "Rejected, record kept on main" : "Not verified, record kept on main");
  return s;
}

export async function buildTree(quizId: string, experiments: VariantExperiment[]): Promise<TreeData> {
  const branches = await neonBranches();
  const byName = new Map((branches ?? []).map((b) => [b.name, b]));
  const mainBranch = branches?.find((b) => b.default || b.primary);
  const db = neon();
  const created = new Map<string, string>();
  if (db) {
    const r = await db
      .query<{ id: string; created_at: Date }>("select e.id, e.created_at from variant_experiment e join item i on i.id = e.item_id where i.quiz_id = $1", [quizId])
      .catch(() => ({ rows: [] as { id: string; created_at: Date }[] }));
    for (const row of r.rows) created.set(row.id, new Date(row.created_at).toISOString());
  }
  const exps = experiments.filter((e) => created.has(e.id) || e.itemId.startsWith(`${quizId}-`));
  const lanes: TreeLane[] = exps.map((e) => {
    const b = byName.get(e.neonBranch);
    const q = e.itemId.match(/-q(\d+)$/)?.[1];
    const k = e.id.match(/-v(\d+)$/)?.[1];
    return {
      kind: "experiment",
      branch: e.neonBranch,
      label: `Q${q} v${k} · ${STRATEGY[e.strategy] ?? e.strategy}`,
      at: b?.parent_timestamp ?? b?.created_at ?? created.get(e.id) ?? new Date(0).toISOString(),
      outcome: outcomeOf(e),
      reason: chip(e.reasons.at(-1)),
      live: !!b,
      merged: e.status === "approved",
      neon: facts(b),
      steps: stepsOf(e),
      variantId: e.id,
    };
  });

  let appeals = 0;
  if (db) {
    const r = await db
      .query<{ branch: string; attempt_id: string; snapshot_lsn: string; created_at: Date; branch_ms: number; total_ms: number; deleted: boolean }>(
        "select branch, attempt_id, snapshot_lsn, created_at, branch_ms, total_ms, deleted from appeal_log where quiz_id = $1 order by created_at",
        [quizId],
      )
      .catch(() => ({ rows: [] as never[] }));
    appeals = r.rows.length;
    for (const a of r.rows) {
      lanes.push({
        kind: "appeal",
        branch: a.branch,
        label: "Appeal · what the student saw",
        at: new Date(a.created_at).toISOString(),
        outcome: "appeal",
        reason: `Branched at LSN ${a.snapshot_lsn}, read, ${a.deleted ? "deleted" : "not yet deleted"} after ${(a.total_ms / 1000).toFixed(1)} s`,
        live: byName.has(a.branch),
        merged: false,
        neon: { forkLsn: a.snapshot_lsn },
        steps: [`Branch created at the attempt's start (LSN ${a.snapshot_lsn}) in ${(a.branch_ms / 1000).toFixed(1)} s`, "Quiz and answer key read as the student saw them", a.deleted ? "Branch deleted" : "Branch still present"],
      });
    }
  }
  lanes.sort((x, y) => x.at.localeCompare(y.at));
  return {
    quizId,
    main: { branch: "main", neon: facts(mainBranch) },
    lanes,
    source: { neonApi: !!branches, experiments: exps.length, appeals },
  };
}
