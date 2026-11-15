// Plain transform runner: chains the steps in ./steps and emits progress events.
// Per candidate: branch -> generate -> write -> solve x3 -> panel. Cheap checks
// short-circuit. Then ONE batched re-attack for everything still alive, decide,
// and merge rows into main (survivors bring their item).
import type { Quiz, VariantExperiment, VariantStrategy } from "@unprompted/shared";
import type { BranchStore } from "./db/types.js";
import {
  decide,
  generateCandidates,
  mergeSurvivor,
  nextVariantNumber,
  objectivePanel,
  reattack,
  saveExperiment,
  solveWithInterpreter,
  writeProposed,
  type ExperimentRow,
  type TransformDeps,
  type TransformEvent,
  type TransformOptions,
  type TransformResult,
  type TransformTarget,
} from "./steps/index.js";

export const ALL_STRATEGIES: VariantStrategy[] = ["isomorphic", "application", "find_error", "counterfactual", "figure_dependency"];

/** Small promise pool so we never fire every LLM call at once. */
async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
      for (let t = queue.shift(); t !== undefined; t = queue.shift()) await fn(t);
    }),
  );
}

export async function runTransform(
  store: BranchStore,
  quiz: Quiz,
  targets: TransformTarget[],
  deps: TransformDeps,
  opts: TransformOptions = {},
): Promise<TransformResult> {
  const n = opts.candidatesPerItem ?? 3;
  const strategies = opts.strategies?.length ? opts.strategies : ALL_STRATEGIES;
  const emit = (e: TransformEvent) => opts.onEvent?.(e);
  const prune = opts.pruneRejectedBranches ?? store.kind === "neon";
  const main = await store.main();

  const rows: ExperimentRow[] = [];
  const alive: { row: ExperimentRow; target: TransformTarget }[] = [];

  const reject = async (row: ExperimentRow, reason: string) => {
    row.experiment.status = "rejected";
    row.experiment.reasons.push(reason);
    const branch = await store.branch(row.experiment.neonBranch);
    await saveExperiment(branch.db, row);
    await mergeSurvivor(store, row.experiment.neonBranch, row.experiment.id, false);
    if (prune) await store.deleteBranch(row.experiment.neonBranch);
    emit({ type: "rejected", experiment: structuredClone(row.experiment) });
  };

  // A check that couldn't run (quota, timeout) is not evidence against the question:
  // keep it "proposed", say why, and never show it as a rejection.
  const leaveUnverified = async (row: ExperimentRow, reason: string) => {
    row.experiment.reasons.push(`not verified: ${reason}`);
    const branch = await store.branch(row.experiment.neonBranch);
    await saveExperiment(branch.db, row);
    await mergeSurvivor(store, row.experiment.neonBranch, row.experiment.id, false);
    if (prune) await store.deleteBranch(row.experiment.neonBranch);
    emit({ type: "error", experimentId: row.experiment.id, message: `not verified: ${reason}` });
  };

  // Reserve variant numbers up front (sequentially) so parallel work never collides.
  // Also skip numbers that already have a branch: a re-executed step (e.g. Mastra restarting an
  // interrupted run) must not collide with branches its first execution created.
  const branchNames = await store.listBranches();
  const plan: { target: TransformTarget; k: number; strategy: VariantStrategy }[] = [];
  for (const target of targets) {
    const prefix = `exp/${target.item.id}/`;
    const branchMax = Math.max(0, ...branchNames.filter((b) => b.startsWith(prefix)).map((b) => Number(b.slice(prefix.length))).filter(Number.isInteger));
    const first = Math.max(await nextVariantNumber(main.db, target.item.id), branchMax + 1);
    for (let i = 0; i < n; i++) plan.push({ target, k: first + i, strategy: strategies[i % strategies.length]! });
  }

  await pool(plan, opts.concurrency ?? 2, async ({ target, k, strategy }) => {
    const source = target.item;
    const id = `${source.id}-v${k}`;
    const branchName = `exp/${source.id}/${k}`;
    const stage = (st: "generating" | "solving" | "judging") => emit({ type: "stage", experimentId: id, itemId: source.id, strategy, stage: st });
    let gen;
    stage("generating");
    try {
      gen = await generateCandidates(deps.generator, source, strategy, k);
    } catch (e) {
      // No candidate means nothing to put on a branch; report it and move on.
      emit({ type: "error", experimentId: id, message: `generator (${strategy}): ${String((e as Error).message ?? e).slice(0, 300)}` });
      return;
    }
    const row: ExperimentRow = {
      generator: gen.generator,
      candidateItemId: id,
      experiment: { id, itemId: source.id, neonBranch: branchName, strategy, candidate: gen.candidate, status: "proposed", checks: {}, reasons: [] },
    };
    rows.push(row);
    try {
      const branch = await store.createBranch(branchName);
      await writeProposed(branch.db, source, row);
      emit({ type: "proposed", experiment: structuredClone(row.experiment), rationale: gen.rationale });

      stage("solving");
      const solve = await solveWithInterpreter(deps.solver, gen.candidate, opts.solveRepeats ?? 3);
      if (solve.incomplete) return leaveUnverified(row, solve.detail);
      row.experiment.checks.answerKeyConsistent = solve.passed;
      emit({ type: "check", experimentId: id, check: "answerKeyConsistent", passed: solve.passed, detail: solve.detail });
      if (!solve.passed) return reject(row, solve.detail);

      stage("judging");
      const panel = await objectivePanel(deps.judges, source, gen.candidate);
      if (panel.incomplete) return leaveUnverified(row, panel.detail);
      row.experiment.checks.objectivePreserved = panel.objectivePreserved;
      row.experiment.checks.unambiguous = panel.unambiguous;
      const total = deps.judges.length;
      emit({ type: "check", experimentId: id, check: "objectivePreserved", passed: panel.objectivePreserved, detail: panel.detail, agree: panel.votes.filter((v) => v.objectivePreserved).length, total });
      emit({ type: "check", experimentId: id, check: "unambiguous", passed: panel.unambiguous, detail: panel.detail, agree: panel.votes.filter((v) => v.unambiguous).length, total });
      if (!panel.objectivePreserved) return reject(row, `changed the learning objective: ${panel.detail}`);
      if (!panel.unambiguous) return reject(row, `ambiguous or wrong key: ${panel.detail}`);

      await saveExperiment(branch.db, row);
      alive.push({ row, target });
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 300);
      emit({ type: "error", experimentId: id, message: msg });
      // Best effort: record it as unverified (not rejected) if the branch exists.
      try {
        await leaveUnverified(row, `pipeline error: ${msg}`);
      } catch {
        /* branch never got created */
      }
    }
  });

  if (alive.length) {
    const batchId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const ids = alive.map((a) => a.row.candidateItemId);
    for (const a of alive) emit({ type: "stage", experimentId: a.row.experiment.id, itemId: a.target.item.id, strategy: a.row.experiment.strategy, stage: "re-attacking" });
    emit({ type: "attack_started", quizId: `${quiz.id}-variants-${batchId}`, itemIds: ids });
    let rates;
    try {
      const res = await reattack(deps.attacker, quiz, alive.map((a) => ({ itemId: a.row.candidateItemId, candidate: a.row.experiment.candidate })), batchId);
      rates = res.solveRates;
      emit({ type: "attack_done", quizId: res.variantQuiz.id, solveRates: [...rates.values()], ...(res.excluded ? { excluded: res.excluded } : {}) });
    } catch (e) {
      // Without a re-attack we can't claim agent resistance: leave them proposed, say why.
      const msg = `re-attack failed, candidates left unverified: ${String((e as Error).message ?? e).slice(0, 300)}`;
      emit({ type: "error", message: msg });
      for (const { row } of alive) {
        row.experiment.reasons.push(msg);
        await saveExperiment((await store.branch(row.experiment.neonBranch)).db, row);
        await mergeSurvivor(store, row.experiment.neonBranch, row.experiment.id, false);
      }
      rates = null;
    }
    if (rates) {
      for (const { row, target } of alive) {
        const next = rates.get(row.candidateItemId);
        if (!next || next.runs === 0) {
          // Every agent run failed for provider reasons: no evidence either way.
          await leaveUnverified(row, "the agent retake produced no valid runs (provider errors), so agent resistance is unmeasured");
          continue;
        }
        row.experiment.checks.newSolveRate = next.solveRate;
        const d = decide(target.solveRate, next, opts);
        if (!d.survives) {
          await reject(row, d.reason);
          continue;
        }
        row.experiment.status = "verified";
        row.experiment.reasons.push(d.reason);
        await saveExperiment((await store.branch(row.experiment.neonBranch)).db, row);
        await mergeSurvivor(store, row.experiment.neonBranch, row.experiment.id, true);
        emit({ type: "verified", experiment: structuredClone(row.experiment) });
      }
    }
  }

  const experiments: VariantExperiment[] = rows.map((r) => r.experiment);
  const survived = new Set(experiments.filter((e) => e.status === "verified").map((e) => e.itemId));
  return { experiments, probePriority: targets.map((t) => t.item.id).filter((id) => !survived.has(id)) };
}
