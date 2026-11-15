// Writes the controlled-retake quiz (original item as control + variants) to a JSON file for A's CLI.
//   tsx --env-file=../../.env.local scripts/retake-quiz.ts <originalItemId> <variantId,...> <out.json>
import { writeFile } from "node:fs/promises";
import { openBranchStore } from "../src/db/index.js";
import { loadQuiz } from "../src/ingest/markdown.js";
const [origId, variantArg, out] = process.argv.slice(2);
const store = await openBranchStore(); const main = (await store.main()).db;
const quizId = origId!.replace(/-q\d+$/, "");
const sourceQuiz = await loadQuiz(main, quizId);
const quizTitle = sourceQuiz.title.replace(/^Sample quiz:\s*/i, "").replace(/\s*\([^)]*\)\s*$/, "");
const original = sourceQuiz.items.find((i) => i.id === origId)!;
const { rows } = await main.query<{ id: string; candidate_json: any }>("select id, candidate_json from variant_experiment where id = any($1) order by id", [variantArg!.split(",")]);
await store.close();
const qid = `${quizId}-retake-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
const quiz = { id: qid, courseId: "sandbox-course", title: `${quizTitle} · practice set ${qid.slice(-6)}`, sourceFormat: "markdown",
  items: [{ ...original, id: `${origId}-control`, quizId: qid, originalItemId: origId }, ...rows.map((r) => { const { figureText: _hidden, ...visible } = r.candidate_json; return { ...visible, id: r.id, quizId: qid }; })] };
await writeFile(out!, JSON.stringify(quiz, null, 2));
console.log(qid, quiz.items.map((i) => i.id).join(","));
setTimeout(() => process.exit(0), 50);
