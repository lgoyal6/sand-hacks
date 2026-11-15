// Judge-proof retake: variants plus the ORIGINAL item as a control, in one quiz, so both are measured
// by the same runs, settings and models. Only submitted, provider-clean runs count (validSolveRates).
//   tsx --env-file=../../.env.local scripts/reattack.ts <originalItemId> <variantId,...> <models,...> <repeatsPerModel> [out.json]
import { writeFile } from "node:fs/promises";
import type { Quiz } from "@unprompted/shared";
import { openBranchStore } from "../src/db/index.js";
import { loadQuiz } from "../src/ingest/markdown.js";
import { REPO_ROOT } from "../src/paths.js";
import { CliAttacker } from "../src/steps/adapters.js";
import { wilson } from "../src/steps/answers.js";

const [origId, variantArg, modelArg, repeatsArg, out] = process.argv.slice(2);
const variantIds = variantArg!.split(",");
const store = await openBranchStore();
const main = (await store.main()).db;
const quizId = origId!.replace(/-q\d+$/, "");
const original = (await loadQuiz(main, quizId)).items.find((i) => i.id === origId)!;
const { rows } = await main.query<{ id: string; candidate_json: any }>("select id, candidate_json from variant_experiment where id = any($1)", [variantIds]);
await store.close();

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const qid = `${quizId}-retake-${stamp}`;
const quiz: Quiz = {
  id: qid, courseId: "sandbox-course", title: "Intro Statistics: practice set", sourceFormat: "markdown",
  items: [{ ...original, id: `${origId}-control`, quizId: qid, originalItemId: origId }, ...rows.map((r) => { const { figureText: _hidden, ...visible } = r.candidate_json; return { ...visible, id: r.id, quizId: qid }; })],
};
const report: Record<string, unknown> = { quizId: qid, items: quiz.items.map((i) => i.id), byModel: {} };
for (const model of modelArg!.split(",")) {
  const t = Date.now();
  const res = await new CliAttacker({ repoRoot: REPO_ROOT, repeats: Number(repeatsArg), models: model, timeoutMs: 90 * 60_000, log: () => {} }).attack(quiz, quiz.items.map((i) => i.id));
  const rowsOut = res.solveRates.map((s) => { const [lo, hi] = wilson(s.correct, s.runs); return { item: s.itemId, correct: s.correct, validRuns: s.runs, rate: s.solveRate, ci95: [+lo.toFixed(3), +hi.toFixed(3)] }; });
  (report.byModel as any)[model] = { excluded: res.excluded, items: rowsOut, minutes: +((Date.now() - t) / 60000).toFixed(1) };
  console.log(model, JSON.stringify((report.byModel as any)[model]));
}
if (out) await writeFile(out, JSON.stringify(report, null, 2) + "\n");
setTimeout(() => process.exit(0), 50);
