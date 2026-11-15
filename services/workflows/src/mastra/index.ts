// Thin Mastra wrapper over the plain steps (no logic lives here).
// Workflow "transform": select-targets -> transform (streams runner events through the step writer).
import { Mastra } from "@mastra/core";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import type { SolveRate } from "@unprompted/shared";
import { z } from "zod";
import type { BranchStore } from "../db/types.js";
import { loadQuiz } from "../ingest/markdown.js";
import { runTransform } from "../runner.js";
import { selectTargets, type TransformDeps, type TransformOptions, type TransformTarget } from "../steps/index.js";

const Input = z.object({
  quizId: z.string(),
  itemIds: z.array(z.string()).optional(),
  solveRates: z.array(z.any()).nullable().default(null),
  leakedItemIds: z.array(z.string()).default([]),
  assumeSolveRate: z.number().nullable().default(null),
});
const Selected = z.object({ quizId: z.string(), targets: z.array(z.any()), notes: z.array(z.string()) });
const Output = z.object({ experiments: z.array(z.any()), probePriority: z.array(z.string()), notes: z.array(z.string()) });

/** Build the workflow around live dependencies (branch store, models, attacker), which aren't serializable inputs. */
export function createTransformWorkflow(ctx: { store: BranchStore; deps: TransformDeps; opts?: Omit<TransformOptions, "onEvent"> }) {
  const select = createStep({
    id: "select-targets",
    description: "Pick agent-solvable or leaked items and attach their original solve rates",
    inputSchema: Input,
    outputSchema: Selected,
    execute: async ({ inputData }) => {
      const quiz = await loadQuiz((await ctx.store.main()).db, inputData.quizId);
      const { targets, notes } = selectTargets(quiz, inputData.solveRates as SolveRate[] | null, inputData.leakedItemIds, {
        itemIds: inputData.itemIds,
        assumeSolveRate: inputData.assumeSolveRate,
      });
      return { quizId: quiz.id, targets, notes };
    },
  });

  const transform = createStep({
    id: "transform",
    description: "Generate, solve x3, panel, re-attack, decide, merge survivors (build plan 4.2)",
    inputSchema: Selected,
    outputSchema: Output,
    execute: async ({ inputData, writer }) => {
      const quiz = await loadQuiz((await ctx.store.main()).db, inputData.quizId);
      const res = await runTransform(ctx.store, quiz, inputData.targets as TransformTarget[], ctx.deps, {
        ...ctx.opts,
        onEvent: (e) => void writer?.write(e),
      });
      return { ...res, notes: inputData.notes };
    },
  });

  return createWorkflow({ id: "transform", inputSchema: Input, outputSchema: Output }).then(select).then(transform).commit();
}

export function createMastra(ctx: Parameters<typeof createTransformWorkflow>[0]) {
  return new Mastra({ workflows: { transform: createTransformWorkflow(ctx) } });
}
