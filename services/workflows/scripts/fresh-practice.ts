// Generate PRACTICE variants on current official data (BLS public API), with the usual key check and
// same-skill panel. Learning material only: no leak or agent-resistance claim, never a graded replacement.
//   tsx --env-file=../../.env.local scripts/fresh-practice.ts <itemId> [n]
import { buildContext } from "../src/context.js";
import { loadQuiz } from "../src/ingest/markdown.js";
import { runTransform } from "../src/runner.js";
import { FreshDataGenerator } from "../src/steps/adapters.js";
import { blsSeries, FRESH_SOURCES } from "../src/steps/freshdata.js";
import { geminiModel } from "../src/steps/llm.js";

const [itemId, nArg] = process.argv.slice(2);
const ctx = await buildContext({ noAttack: true });
const model = geminiModel("gemini-3.6-flash");
if (!model) throw new Error("No Gemini access (GMI_API_KEY or GEMINI_API_KEY).");
const quizId = itemId!.replace(/-q\d+$/, "");
const quiz = await loadQuiz((await ctx.store.main()).db, quizId);
const item = quiz.items.find((i) => i.id === itemId);
if (!item) throw new Error(`no item ${itemId}`);
const res = await runTransform(
  ctx.store,
  quiz,
  [{ item, solveRate: 1 }],
  { ...ctx.deps, generator: new FreshDataGenerator(model, (k) => blsSeries(FRESH_SOURCES[k % FRESH_SOURCES.length]!)), leakChecker: undefined },
  {
    candidatesPerItem: Number(nArg ?? 2),
    strategies: ["fresh_data"],
    onEvent: (e) => {
      if (e.type === "check") console.log(`  ${e.experimentId} ${e.passed ? "pass" : "FAIL"} ${e.check}: ${e.detail.slice(0, 120)}`);
      if (e.type === "proposed") console.log(`  ${e.experiment.id} proposed: ${e.experiment.candidate.stem.slice(0, 160)}`);
      if (e.type === "rejected" || e.type === "verified") console.log(`  ${e.experiment.id} ${e.type.toUpperCase()}: ${e.experiment.reasons.at(-1)?.slice(0, 160)}`);
      if (e.type === "error") console.log(`  error: ${e.message.slice(0, 160)}`);
    },
  },
);
console.log(`${res.experiments.filter((e) => e.status === "verified").length}/${res.experiments.length} practice variants ready`);
await ctx.store.close();
setTimeout(() => process.exit(0), 50);
