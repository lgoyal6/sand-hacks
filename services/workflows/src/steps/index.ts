// Plain, typed transform steps (build plan 4.2). No orchestration framework in here:
// the runner (../runner.ts) chains them, and Mastra (if kept) only wraps them.
import type { Item, Quiz, SolveRate, VariantExperiment, VariantStrategy } from "@unprompted/shared";
import type { BranchStore, Db } from "../db/types.js";
import { mergeVariant } from "../db/merge.js";
import { answerText, sameAnswer, wilson } from "./answers.js";
import type { Attacker, Candidate, GeneratedCandidate, Generator, Judge, PanelVote, Solver, SolveResult } from "./types.js";

export * from "./types.js";

/** 1. Generate one candidate variant of `source` with a strategy. */
export function generateCandidates(generator: Generator, source: Item, strategy: VariantStrategy, k: number): Promise<GeneratedCandidate> {
  return generator.generate(source, strategy, k);
}

export interface SolveCheck {
  passed: boolean;
  /** Some runs failed (quota, timeout, no FINAL line): no verdict either way. */
  incomplete: boolean;
  answers: SolveResult[];
  errors: string[];
  detail: string;
}

/**
 * 2. Solve the candidate `repeats` times with a code-interpreter solver.
 * Passes only if every run finishes, all runs agree, and they agree with the generator's key.
 */
export async function solveWithInterpreter(solver: Solver, candidate: Candidate, repeats = 3): Promise<SolveCheck> {
  const settled = await Promise.allSettled(Array.from({ length: repeats }, (_, i) => solver.solve(candidate, i)));
  const answers = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  const errors = settled.flatMap((s) => (s.status === "rejected" ? [String((s.reason as Error)?.message ?? s.reason)] : []));
  const key = answerText(candidate.answerKey);
  const agreeKey = answers.filter((a) => sameAnswer(candidate.type, a.answer, key)).length;
  const incomplete = errors.length > 0;
  const passed = !incomplete && agreeKey === repeats;
  const got = answers.map((a) => a.answer).join(", ") || "none";
  const detail = passed
    ? `solver matched key "${key}" ${repeats}/${repeats}${answers.every((a) => a.usedCode) ? " (ran code each time)" : ""}`
    : incomplete
      ? `solver did not finish ${errors.length}/${repeats} runs: ${errors[0]!.slice(0, 160)}`
      : `answer key "${key}" not reproduced: solver gave ${got}`;
  return { passed, incomplete, answers, errors, detail };
}

export interface PanelCheck {
  /** A seat failed to vote (quota, timeout): no verdict either way. */
  incomplete: boolean;
  objectivePreserved: boolean;
  unambiguous: boolean;
  votes: PanelVote[];
  detail: string;
}

/** 3. Three-seat panel; each property must be unanimous. A seat that fails to vote makes the check incomplete, not a "no". */
export async function objectivePanel(judges: Judge[], source: Item, candidate: Candidate): Promise<PanelCheck> {
  const settled = await Promise.allSettled(judges.map((j) => j.vote(source, candidate)));
  const failed = settled.flatMap((s, i) => (s.status === "rejected" ? [`${judges[i]!.name}: ${String((s.reason as Error)?.message ?? s.reason).slice(0, 160)}`] : []));
  const votes = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (failed.length) {
    return { incomplete: true, objectivePreserved: false, unambiguous: false, votes, detail: `panel incomplete (${failed.length}/${judges.length} seats failed): ${failed[0]}` };
  }
  const objectivePreserved = votes.every((v) => v.objectivePreserved);
  const unambiguous = votes.every((v) => v.unambiguous);
  const dissent = votes.filter((v) => !v.objectivePreserved || !v.unambiguous);
  const detail = dissent.length
    ? dissent.map((v) => `${v.judge}: ${v.reason}`).join(" | ")
    : `panel ${votes.length}/${votes.length}: same objective, unambiguous`;
  return { incomplete: false, objectivePreserved, unambiguous, votes, detail };
}

/**
 * 4. Re-attack candidates with Workstream A's agents in one batch (one browser at a time on 8 GB).
 * Candidates go out as a shared Quiz whose items carry originalItemId.
 */
export async function reattack(
  attacker: Attacker,
  quiz: Quiz,
  candidates: { itemId: string; candidate: Candidate }[],
  batchId: string,
): Promise<{ variantQuiz: Quiz; solveRates: Map<string, SolveRate>; excluded?: import("./types.js").AttackResult["excluded"] }> {
  const variantQuiz: Quiz = {
    id: `${quiz.id}-variants-${batchId}`,
    courseId: quiz.courseId,
    title: `${quiz.title} (variant candidates)`,
    sourceFormat: quiz.sourceFormat,
    // figureText is for the checkers only; agents get the image (candidate.figure), never the data as text.
    items: candidates.map(({ itemId, candidate: { figureText: _hidden, ...visible } }) => ({ ...visible, id: itemId, quizId: `${quiz.id}-variants-${batchId}` })),
  };
  const { solveRates, excluded } = await attacker.attack(variantQuiz, variantQuiz.items.map((i) => i.id));
  return { variantQuiz, solveRates: new Map(solveRates.map((s) => [s.itemId, s])), excluded };
}

export interface Decision {
  survives: boolean;
  reason: string;
}

/** 5. Survival rule (4.2 step 5): new solve rate <= maxNew AND at least minDrop below the original. */
export function decide(original: number, next: SolveRate | undefined, opts: { maxNewSolveRate?: number; minDrop?: number } = {}): Decision {
  const maxNew = opts.maxNewSolveRate ?? 0.3;
  const minDrop = opts.minDrop ?? 0.4;
  if (!next || next.runs === 0) return { survives: false, reason: "re-attack produced no runs for this candidate" };
  const r = next.solveRate;
  const fmt = (x: number) => `${Math.round(x * 100)}%`;
  const [lo, hi] = wilson(next.correct, next.runs);
  const runs = `${next.correct}/${next.runs} valid agent runs, 95% CI ${fmt(lo)}-${fmt(hi)}`;
  if (r > maxNew) return { survives: false, reason: `agents still solve it: ${runs} (${fmt(r)}, needs <= ${fmt(maxNew)})` };
  if (original - r < minDrop - 1e-9) {
    return { survives: false, reason: `solve rate only fell from ${fmt(original)} to ${fmt(r)} (needs a drop of ${fmt(minDrop)})` };
  }
  return { survives: true, reason: `solve rate fell from ${fmt(original)} to ${fmt(r)} (${runs})` };
}

/** 6. Copy the experiment row to main; survivors also bring their candidate item. */
export function mergeSurvivor(store: BranchStore, branchName: string, experimentId: string, verified: boolean): Promise<void> {
  return mergeVariant(store, branchName, experimentId, { withItem: verified });
}

// ---------- branch rows ----------

export interface ExperimentRow {
  experiment: VariantExperiment;
  generator: string;
  candidateItemId: string;
}

/** Write the candidate item and its proposed experiment to the experiment branch. */
export async function writeProposed(db: Db, source: Item, row: ExperimentRow): Promise<void> {
  const c = row.experiment.candidate as Candidate;
  await db.query(
    `insert into item (id, quiz_id, stem, type, choices_json, answer_key, objective, original_item_id, figure_json, figure_text)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [row.candidateItemId, source.quizId, c.stem, c.type, c.choices ? JSON.stringify(c.choices) : null, JSON.stringify(c.answerKey), c.objective, source.id, c.figure ? JSON.stringify(c.figure) : null, c.figureText ?? null],
  );
  await saveExperiment(db, row);
}

/** Insert or update the experiment row (status, checks, reasons) on a branch. */
export async function saveExperiment(db: Db, row: ExperimentRow): Promise<void> {
  const e = row.experiment;
  await db.query(
    `insert into variant_experiment (id, item_id, neon_branch, generator, strategy, candidate_json, status, reasons_json, checks_json, candidate_item_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (id) do update set status = excluded.status, reasons_json = excluded.reasons_json, checks_json = excluded.checks_json`,
    [e.id, e.itemId, e.neonBranch, row.generator, e.strategy, JSON.stringify(e.candidate), e.status, JSON.stringify(e.reasons), JSON.stringify(e.checks), row.candidateItemId],
  );
}

/** Next free variant number k for an item, so re-runs never collide (`<itemId>-v<k>`). */
export async function nextVariantNumber(db: Db, itemId: string): Promise<number> {
  const { rows } = await db.query<{ id: string }>("select id from variant_experiment where item_id = $1", [itemId]);
  const ks = rows.map((r) => Number(r.id.slice(itemId.length + 2))).filter((n) => Number.isInteger(n));
  return (ks.length ? Math.max(...ks) : 0) + 1;
}

/** Read all experiments on main as shared VariantExperiment objects (for variants.json and the studio). */
export async function loadExperiments(db: Db, quizId?: string): Promise<VariantExperiment[]> {
  const { rows } = await db.query<{
    id: string;
    item_id: string;
    neon_branch: string;
    strategy: VariantExperiment["strategy"];
    candidate_json: VariantExperiment["candidate"];
    status: VariantExperiment["status"];
    checks_json: VariantExperiment["checks"] | null;
    reasons_json: string[] | null;
  }>(
    quizId
      ? "select e.* from variant_experiment e join item i on i.id = e.item_id where i.quiz_id = $1 order by e.created_at, e.id"
      : "select * from variant_experiment order by created_at, id",
    quizId ? [quizId] : [],
  );
  return rows.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    neonBranch: r.neon_branch,
    strategy: r.strategy,
    candidate: r.candidate_json,
    status: r.status,
    checks: r.checks_json ?? {},
    reasons: r.reasons_json ?? [],
  }));
}

// ---------- 0. target selection ----------

export interface SelectOptions {
  /** Explicit item ids; otherwise agent-solvable (A) or leaked (D) items. */
  itemIds?: string[];
  /** Used when A has no solve rate for an item; recorded as an assumption in notes. */
  assumeSolveRate?: number | null;
}

/** Pick items to transform and attach their original solve rate. Throws rather than guessing a rate. */
export function selectTargets(
  quiz: Quiz,
  solveRates: SolveRate[] | null,
  leakedItemIds: string[],
  opts: SelectOptions = {},
): { targets: import("./types.js").TransformTarget[]; notes: string[] } {
  const targets: import("./types.js").TransformTarget[] = [];
  const notes: string[] = [];
  const unconfirmed = quiz.items.filter((i) => i.objectiveSource === "inferred" && opts.itemIds?.includes(i.id));
  if (unconfirmed.length) {
    // The rewriter and the judges hold the objective fixed, so a guessed one (a Canvas title) must be confirmed first.
    throw new Error(`confirm the learning objective first: ${unconfirmed.map((i) => i.id).join(", ")} still has the one guessed at import`);
  }
  for (const item of quiz.items) {
    if (opts.itemIds && !opts.itemIds.includes(item.id)) continue;
    if (item.objectiveSource === "inferred") {
      notes.push(`${item.id}: skipped, learning objective not confirmed by the professor`);
      continue;
    }
    const r = solveRates?.find((s) => s.itemId === item.id);
    const leaked = leakedItemIds.includes(item.id);
    if (!opts.itemIds && !(r?.agentSolvable || leaked)) continue;
    let solveRate = r?.solveRate;
    if (solveRate == null) {
      if (leaked && opts.assumeSolveRate == null) {
        // Leaked questions are worth rewriting even without an agent baseline (e.g. a fresh Canvas import).
        targets.push({ item, solveRate: 0, leaked });
        notes.push(`${item.id}: no agent baseline; chosen because it was found online`);
        continue;
      }
      if (opts.assumeSolveRate == null) throw new Error(`no solve rate for ${item.id} (A's solve_rates.json); pass assumeSolveRate to proceed`);
      solveRate = opts.assumeSolveRate;
      notes.push(`${item.id}: original solve rate ASSUMED ${opts.assumeSolveRate} (no agent runs yet)`);
    }
    targets.push({ item, solveRate, leaked });
  }
  return { targets, notes };
}

// ---------- 7. professor decision (human in the loop) ----------

export interface ApprovalDecision {
  id: string;
  approve: boolean;
  note?: string;
}

/**
 * Apply the professor's decisions on main. Only verified variants can be decided:
 * approve -> "approved"; reject -> "rejected" with the professor's reason.
 * Returns the ids that changed (anything else was not verified, or already decided).
 */
export async function applyApprovals(db: Db, decisions: ApprovalDecision[]): Promise<string[]> {
  const changed: string[] = [];
  for (const d of decisions) {
    const reason = d.approve ? null : `Rejected by professor${d.note ? `: ${d.note}` : ""}`;
    const { rows } = await db.query<{ id: string }>(
      `update variant_experiment
          set status = $2,
              reasons_json = case when $3::text is null then reasons_json else coalesce(reasons_json, '[]'::jsonb) || to_jsonb($3::text) end
        where id = $1 and status = 'verified'
        returning id`,
      [d.id, d.approve ? "approved" : "rejected", reason],
    );
    if (rows[0]) changed.push(rows[0].id);
  }
  return changed;
}

// ---------- like-for-like baseline ----------

/** The agent model used for retakes; the baseline must come from the same model. */
export const DEFAULT_ATTACK_MODEL = "gmi:google/gemini-3.8-flash";

/**
 * Original solve rates for one agent model, from A's agent_runs.json. Comparing a variant's retake
 * against a pooled baseline (several models) would mix model strength into the measured drop.
 */
export function baselineSolveRates(runs: import("@unprompted/shared").AgentRun[], model: string, quizId: string): SolveRate[] {
  const by = new Map<string, { correct: number; runs: number }>();
  for (const r of runs) {
    if (r.quizId !== quizId || r.model !== model) continue;
    const b = by.get(r.itemId) ?? { correct: 0, runs: 0 };
    b.runs += 1;
    if (r.correct) b.correct += 1;
    by.set(r.itemId, b);
  }
  return [...by].map(([itemId, b]) => ({ itemId, runs: b.runs, correct: b.correct, solveRate: b.correct / b.runs, agentSolvable: b.correct / b.runs >= 0.6 }));
}
