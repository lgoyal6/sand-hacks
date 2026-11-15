// Mastra workflow for the transform pipeline (build plan 4.2), with human in the loop.
// All logic lives in the plain steps (../steps, ../runner); Mastra orchestrates, streams
// events, suspends for the professor's decision and persists run state (Neon, schema "mastra").
//
//   select-targets -> transform -> professor-approval (suspends until /studio resumes it)
import { Mastra } from "@mastra/core";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { PostgresStore } from "@mastra/pg";
import type { SolveRate, VariantExperiment } from "@unprompted/shared";
import { z } from "zod";
import { buildContext, type ContextOptions, type TransformContext } from "../context.js";
import { loadQuiz } from "../ingest/markdown.js";
import { runTransform } from "../runner.js";
import { applyApprovals, loadExperiments, selectTargets, type TransformTarget } from "../steps/index.js";
import { envVal } from "../steps/llm.js";

// ---- live dependencies: built lazily from env, or injected (tests) ----
let ctxPromise: Promise<TransformContext> | null = null;
let ctxOptions: ContextOptions = {};
export function setTransformContext(ctx: TransformContext | null, opts: ContextOptions = {}) {
  ctxPromise = ctx ? Promise.resolve(ctx) : null;
  ctxOptions = opts;
}
function ctx(): Promise<TransformContext> {
  ctxPromise ??= buildContext(ctxOptions);
  return ctxPromise;
}

// ---- schemas ----
const Input = z.object({
  quizId: z.string(),
  itemIds: z.array(z.string()).optional(),
  solveRates: z.array(z.any()).nullable().default(null),
  leakedItemIds: z.array(z.string()).default([]),
  assumeSolveRate: z.number().nullable().default(null),
  candidatesPerItem: z.number().int().min(1).max(5).default(2),
});
const Selected = z.object({
  quizId: z.string(),
  targets: z.array(z.any()),
  notes: z.array(z.string()),
  candidatesPerItem: z.number(),
});
const Transformed = z.object({
  quizId: z.string(),
  experiments: z.array(z.any()),
  probePriority: z.array(z.string()),
  notes: z.array(z.string()),
});
const Waiting = z.object({
  verified: z.array(z.object({ id: z.string(), itemId: z.string(), strategy: z.string(), stem: z.string(), reason: z.string().optional() })),
});
const Decisions = z.object({
  decisions: z.array(z.object({ id: z.string(), approve: z.boolean(), note: z.string().optional() })),
});
const Final = z.object({
  quizId: z.string(),
  experiments: z.array(z.any()),
  probePriority: z.array(z.string()),
  notes: z.array(z.string()),
  decided: z.array(z.string()),
});

// ---- steps (thin: each calls a plain function) ----
export const selectTargetsStep = createStep({
  id: "select-targets",
  description: "Pick agent-solvable or leaked items and attach their measured solve rates",
  inputSchema: Input,
  outputSchema: Selected,
  execute: async ({ inputData }) => {
    const { store } = await ctx();
    const quiz = await loadQuiz((await store.main()).db, inputData.quizId);
    const { targets, notes } = selectTargets(quiz, inputData.solveRates as SolveRate[] | null, inputData.leakedItemIds, {
      itemIds: inputData.itemIds,
      assumeSolveRate: inputData.assumeSolveRate,
    });
    return { quizId: quiz.id, targets, notes, candidatesPerItem: inputData.candidatesPerItem };
  },
});

export const transformStep = createStep({
  id: "transform",
  description: "Rewrite, solve x3 with code, 3-model panel, agent re-attack, keep survivors (one Neon branch per candidate)",
  inputSchema: Selected,
  outputSchema: Transformed,
  execute: async ({ inputData, writer }) => {
    const { store, deps } = await ctx();
    const quiz = await loadQuiz((await store.main()).db, inputData.quizId);
    const res = await runTransform(store, quiz, inputData.targets as TransformTarget[], deps, {
      candidatesPerItem: inputData.candidatesPerItem,
      onEvent: (e) => void writer?.write(e),
    });
    return { quizId: quiz.id, experiments: res.experiments, probePriority: res.probePriority, notes: inputData.notes };
  },
});

export const approvalStep = createStep({
  id: "professor-approval",
  description: "Pause until the professor approves or rejects each verified variant in /studio",
  inputSchema: Transformed,
  outputSchema: Final,
  suspendSchema: Waiting,
  resumeSchema: Decisions,
  execute: async ({ inputData, resumeData, suspend }) => {
    const verified = (inputData.experiments as VariantExperiment[]).filter((e) => e.status === "verified");
    if (!verified.length) return { ...inputData, decided: [] };
    if (!resumeData) {
      return suspend({
        verified: verified.map((e) => ({ id: e.id, itemId: e.itemId, strategy: e.strategy, stem: e.candidate.stem, reason: e.reasons.at(-1) })),
      });
    }
    const { store } = await ctx();
    const main = (await store.main()).db;
    const decided = await applyApprovals(main, resumeData.decisions);
    // Return the experiments as they now stand on main.
    const now = await loadExperiments(main, inputData.quizId);
    const ids = new Set((inputData.experiments as VariantExperiment[]).map((e) => e.id));
    return { ...inputData, experiments: now.filter((e) => ids.has(e.id)), decided };
  },
});

export const transformWorkflow = createWorkflow({
  id: "transform",
  description: "Make agent-solvable quiz questions agent-resistant without changing what they test",
  inputSchema: Input,
  outputSchema: Final,
})
  .then(selectTargetsStep)
  .then(transformStep)
  .then(approvalStep)
  .commit();

/** Workflow run state in Neon (schema "mastra"), so a suspended run survives a restart. */
function storage() {
  const url = envVal("DATABASE_URL");
  return url ? new PostgresStore({ id: "unprompted-mastra", connectionString: url, schemaName: "mastra" }) : undefined;
}

const store = storage();
export const mastra = new Mastra({
  workflows: { transform: transformWorkflow },
  ...(store ? { storage: store } : {}),
});
