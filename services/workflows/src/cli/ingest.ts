// Import a Markdown quiz into main and write data/fixtures/quiz-<id>.json.
//   pnpm --filter @unprompted/workflows ingest data/quizzes/sample-stats.md (quiz id defaults to the file slug, here sample-stats)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT } from "../paths.js";
import { openBranchStore } from "../db/index.js";
import { parseMarkdownQuiz, saveQuiz } from "../ingest/markdown.js";

const ROOT = REPO_ROOT;
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "quiz-id": { type: "string" }, "course-id": { type: "string", default: "sandbox-course" } },
});
const file = positionals[0] ?? "data/quizzes/sample-stats.md";
const quizId = values["quiz-id"] ?? path.basename(file, ".md");

const quiz = parseMarkdownQuiz(await readFile(path.resolve(ROOT, file), "utf8"), { quizId, courseId: values["course-id"]! });
const store = await openBranchStore();
try {
  const db = (await store.main()).db;
  await saveQuiz(db, quiz);
  // The curated course quizzes (data/quizzes/*.md) are what students see; studio imports start unpublished.
  if (path.resolve(ROOT, file).startsWith(path.join(REPO_ROOT, "data/quizzes") + path.sep)) await db.query("update quiz set published = true where id = $1", [quiz.id]);
} finally {
  await store.close();
}
const out = path.join(ROOT, "data/fixtures", `quiz-${quizId}.json`);
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(quiz, null, 2) + "\n");
console.log(`Imported ${quiz.items.length} items into ${store.kind} main; wrote ${path.relative(ROOT, out)}`);
