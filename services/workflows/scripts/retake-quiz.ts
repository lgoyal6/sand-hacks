// Writes the controlled-retake quiz (original item as control + variants) to a JSON file for A's CLI.
//   tsx --env-file=../../.env.local scripts/retake-quiz.ts <originalItemId> <variantId,...> <out.json>
import { writeFile } from "node:fs/promises";
import { openBranchStore } from "../src/db/index.js";
import { loadQuiz } from "../src/ingest/markdown.js";
const [origId, variantArg, out] = process.argv.slice(2);
const store = await openBranchStore(); const main = (await store.main()).db;
const quizId = origId!.replace(/-q\d+$/, "");
const original = (await loadQuiz(main, quizId)).items.find((i) => i.id === origId)!;
const { rows } = await main.query<{ id: string; candidate_json: any }>("select id, candidate_json from variant_experiment where id = any($1) order by id", [variantArg!.split(",")]);
await store.close();
const qid = `${quizId}-retake-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
const quiz = { id: qid, courseId: "sandbox-course", title: "Intro Statistics: practice set", sourceFormat: "markdown",
  items: [{ ...original, id: `${origId}-control`, quizId: qid, originalItemId: origId }, ...rows.map((r) => ({ ...r.candidate_json, id: r.id, quizId: qid }))] };
await writeFile(out!, JSON.stringify(quiz, null, 2));
console.log(qid, quiz.items.map((i) => i.id).join(","));
setTimeout(() => process.exit(0), 50);
