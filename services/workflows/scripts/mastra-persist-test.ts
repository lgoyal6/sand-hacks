// Proves a suspended transform run survives a process restart (state in Neon, schema "mastra").
// Uses fake models and an in-memory branch store, so it spends no LLM quota and writes no app rows.
//   tsx --env-file=../../.env.local scripts/mastra-persist-test.ts start    -> prints runId, exits while suspended
//   tsx --env-file=../../.env.local scripts/mastra-persist-test.ts resume <runId>
import { readFile } from "node:fs/promises";
import { loadSchema, PGliteBranchStore } from "../src/db/index.js";
import { parseMarkdownQuiz, saveQuiz } from "../src/ingest/markdown.js";
import { mastra, setTransformContext } from "../src/mastra/index.js";
import type { Judge } from "../src/steps/types.js";

const [mode, runId] = process.argv.slice(2);
const store = await PGliteBranchStore.create(await loadSchema());
const quiz = parseMarkdownQuiz(await readFile(new URL("../../../data/quizzes/sample-stats.md", import.meta.url), "utf8"), { quizId: "sample-stats", courseId: "c1" });
await saveQuiz((await store.main()).db, quiz);
const judge: Judge = { name: "fake", vote: async () => ({ judge: "fake", objectivePreserved: true, unambiguous: true, reason: "ok" }) };
setTransformContext({
  store,
  describe: "fakes",
  independentPanel: false,
  deps: {
    generator: { generate: async (s, strategy, k) => ({ generator: "fake", rationale: "fake", candidate: { stem: `${s.stem} v${k}`, type: "mcq", choices: [{ id: "a", text: "1" }, { id: "b", text: "2" }, { id: "c", text: "3" }], answerKey: "a", objective: s.objective, originalItemId: s.id } }) },
    solver: { solve: async () => ({ answer: "a", usedCode: true, model: "fake" }) },
    judges: [judge, judge, judge],
    attacker: { attack: async (q) => ({ solveRates: q.items.map((i) => ({ itemId: i.id, runs: 9, correct: 0, solveRate: 0, agentSolvable: false })) }) },
  },
});

const wf = mastra.getWorkflow("transform");
if (mode === "start") {
  const run = await wf.createRun();
  const res = await run.start({ inputData: { quizId: "sample-stats", itemIds: ["sample-stats-q1"], solveRates: null, leakedItemIds: [], assumeSolveRate: 1, candidatesPerItem: 1, attackModel: "test:no-baseline" } });
  console.log(`status=${res.status} runId=${run.runId}`);
} else {
  const run = await wf.createRun({ runId });
  const res = await run.resume({ step: "professor-approval", resumeData: { decisions: [{ id: "sample-stats-q1-v1", approve: true }] } });
  console.log(`status=${res.status}`, res.status === "success" ? `decided=${JSON.stringify((res as { result: { decided: string[] } }).result.decided)}` : JSON.stringify(res).slice(0, 300));
}
await store.close();
process.exit(0);
