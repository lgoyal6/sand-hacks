// Experiment tree (owner: B): a git-style graph of one quiz's Neon branches.
// main runs down the left; each experiment branch exp/<item>/<k> forks off at its creation time;
// appeal branches (time travel) are short-lived side branches from appeal_log.
// Neon facts come only from the Neon API; anything it doesn't report is omitted, never estimated.
import "server-only";
import type { VariantExperiment } from "@unprompted/shared";
import { neon } from "@/lib/db/neon";
import { consoleUrl, listBranches, type BranchInfo } from "./neon-branches";

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
  /** Neon's branch id (br-…), when the branch still exists. */
  branchId?: string;
  /** What it was created from, as Neon reports it. */
  parent?: { name: string; lsn?: string; at?: string };
  /** Neon console page for the branch (live branches only). */
  consoleUrl?: string;
  /** One plain line: kept and merged into main / rejected: reason / still open. */
  status?: string;
}

export interface TreeData {
  quizId: string;
  main: { branch: "main"; neon?: NeonFacts; branchId?: string; consoleUrl?: string };
  lanes: TreeLane[];
  source: { neonApi: boolean; experiments: number; appeals: number };
}

function facts(b: BranchInfo | undefined): NeonFacts | undefined {
  if (!b) return undefined;
  const f: NeonFacts = {};
  if (b.createdAt) f.createdAt = b.createdAt;
  if (b.parentTimestamp) f.forkTimestamp = b.parentTimestamp;
  if (b.parentLsn) f.forkLsn = b.parentLsn;
  if (typeof b.logicalSizeBytes === "number") f.logicalSizeBytes = b.logicalSizeBytes;
  if (typeof b.writtenBytes === "number") f.writtenBytes = b.writtenBytes;
  return f;
}

/** Status line from the experiment record on main (the branch itself may have been pruned). */
function statusOf(e: VariantExperiment, live: boolean): string {
  const why = chip(e.reasons.at(-1));
  if (e.status === "approved") return "Kept: merged into main and approved";
  if (e.status === "verified") return "Kept: merged into main, waiting for your approval";
  if (e.status === "rejected") return `Rejected${why ? `: ${why}` : ""} (record kept on main)`;
  return live ? `Still open${why ? `: ${why}` : ""}` : `Not verified${why ? `: ${why}` : ""} (record kept on main)`;
}

const STRATEGY: Record<string, string> = {
  isomorphic: "new numbers",
  application: "real-world setting",
  find_error: "find the error",
  figure_dependency: "figure only",
  counterfactual: "what-if",
  fresh_data: "practice with real data",
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
  if (e.checks.leakFree === true) s.push("Leak check: not found online");
  else if (e.checks.leakFree === false) s.push(`Leak check: found online on ${(e.checks.leakSources ?? []).join(", ") || "the web"}`);
  if (e.checks.newSolveRate !== undefined && e.status !== "proposed") s.push(`Agent solve rate: ${Math.round(e.checks.newSolveRate * 100)}% (for information)`);
  s.push(e.status === "approved" ? "Approved and merged into the quiz" : e.status === "verified" ? "Ready (same answer, same skill, not online), merged to main, waiting for approval" : e.status === "rejected" ? "Rejected, record kept on main" : "Not verified, record kept on main");
  return s;
}

export async function buildTree(quizId: string, experiments: VariantExperiment[]): Promise<TreeData> {
  const list = await listBranches({ maxAgeMs: 0 });
  const branches = list?.branches ?? null;
  const byName = new Map((branches ?? []).map((b) => [b.name, b]));
  const mainBranch = branches?.find((b) => b.isDefault);
  const link = (b?: BranchInfo) => (list && b ? consoleUrl(list.projectId, b.id) : undefined);
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
      at: b?.parentTimestamp ?? b?.createdAt ?? created.get(e.id) ?? new Date(0).toISOString(),
      outcome: outcomeOf(e),
      reason: chip(e.reasons.at(-1)),
      live: !!b,
      merged: e.status === "approved",
      neon: facts(b),
      steps: stepsOf(e),
      variantId: e.id,
      ...(b ? { branchId: b.id, consoleUrl: link(b), parent: { name: b.parentName ?? "main", lsn: b.parentLsn, at: b.parentTimestamp ?? b.createdAt } } : {}),
      status: statusOf(e, !!b),
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
  // Kept candidates first, then the rest; appeals last. Oldest first within each group.
  const rank = (l: TreeLane) =>
    l.kind === "appeal" ? 5 : l.outcome === "approved" ? 0 : l.outcome === "verified" ? 1 : l.outcome === "not verified" && l.live ? 2 : l.outcome === "rejected" ? 3 : 4;
  lanes.sort((x, y) => rank(x) - rank(y) || x.at.localeCompare(y.at));
  return {
    quizId,
    main: { branch: "main", neon: facts(mainBranch), ...(mainBranch ? { branchId: mainBranch.id, consoleUrl: link(mainBranch) } : {}) },
    lanes,
    source: { neonApi: !!branches, experiments: exps.length, appeals },
  };
}

/** Server-side entry for other pages (e.g. /professor): the quiz's experiments from Neon main + the tree. */
export async function loadTree(quizId: string): Promise<TreeData> {
  const { getStudioData } = await import("./data");
  const data = await getStudioData(quizId);
  return buildTree(quizId, data.experiments);
}
