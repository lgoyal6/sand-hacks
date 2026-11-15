// Canvas QTI 1.2 round trip (used by the studio routes).
//   tsx src/cli/qti.ts import <export.zip|.imscc> [--quiz-id id] [--course-id id]   -> JSON {quizId, title, items, skipped}
//   tsx src/cli/qti.ts export <quizId> <out> [--format qti|cc]                    -> JSON {exported, skipped, variants, format}
//     qti (default): QTI .zip for Canvas's "QTI .zip file" import. cc: Common Cartridge .imscc, for Canvas
//     installs that only offer "Canvas Course Export Package" / "Common Cartridge 1.x Package".
// Export = the DELIVERED quiz: each slot's latest professor-approved variant (delivered_item), else the original.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { openBranchStore } from "../db/index.js";
import { saveQuiz } from "../ingest/markdown.js";
import { REPO_ROOT } from "../paths.js";
import { exportCommonCartridge, exportQti, importQti, type QtiItem } from "../qti/index.js";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { "quiz-id": { type: "string" }, "course-id": { type: "string", default: "sandbox-course" }, format: { type: "string", default: "qti" } } });
const [cmd, a, b] = positionals;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "canvas-quiz";

const store = await openBranchStore();
try {
  const db = (await store.main()).db;
  if (cmd === "import") {
    const bytes = new Uint8Array(await readFile(path.resolve(a!)));
    const probe = importQti(bytes, { quizId: "probe", courseId: values["course-id"]! });
    let quizId = values["quiz-id"] ?? slug(probe.quiz.title);
    for (let i = 2; (await db.query("select 1 from quiz where id = $1", [quizId])).rows.length; i++) quizId = `${values["quiz-id"] ?? slug(probe.quiz.title)}-${i}`;
    const { quiz, skipped } = importQti(bytes, { quizId, courseId: values["course-id"]! });
    await saveQuiz(db, quiz);
    await writeFile(path.join(REPO_ROOT, "data/fixtures", `quiz-${quizId}.json`), JSON.stringify(quiz, null, 2) + "\n");
    console.log(JSON.stringify({ quizId, title: quiz.title, items: quiz.items.length, types: quiz.items.map((i) => i.type), skipped }));
  } else if (cmd === "export") {
    const quizId = a!;
    const q = (await db.query<{ title: string }>("select title from quiz where id = $1", [quizId])).rows[0];
    if (!q) throw new Error(`quiz not found: ${quizId}`);
    const { rows } = await db.query<{
      item_id: string; stem: string; type: QtiItem["type"]; choices_json: QtiItem["choices"] | null; answer_key: QtiItem["answerKey"];
      objective: string; figure_json: { src: string; alt: string } | null; is_variant: boolean;
    }>("select * from delivered_item where quiz_id = $1 order by slot", [quizId]);
    const items: QtiItem[] = rows.map((r) => ({
      id: r.item_id, quizId, stem: r.stem, type: r.type, ...(r.choices_json ? { choices: r.choices_json } : {}),
      answerKey: r.answer_key, objective: r.objective, originalItemId: null, ...(r.figure_json ? { figure: r.figure_json } : {}),
    }));
    const title = q.title.replace(/^Sample quiz:\s*/i, "").replace(/\s*\([^)]*\)\s*$/, "");
    if (values.format !== "qti" && values.format !== "cc") throw new Error(`unknown --format ${values.format} (qti or cc)`);
    const out = (values.format === "cc" ? exportCommonCartridge : exportQti)({ id: quizId, title, items });
    await writeFile(path.resolve(b!), out.zip);
    console.log(JSON.stringify({ exported: out.exported.length, skipped: out.skipped, variants: rows.filter((r) => r.is_variant).map((r) => r.item_id), bytes: out.zip.length, format: values.format }));
  } else if (cmd === "save") {
    // A Quiz JSON produced elsewhere (e.g. the Canvas API import in apps/web) -> Neon main + fixture.
    const quiz = JSON.parse(await readFile(path.resolve(a!), "utf8")) as import("@unprompted/shared").Quiz;
    let quizId = quiz.id;
    for (let i = 2; (await db.query("select 1 from quiz where id = $1", [quizId])).rows.length; i++) quizId = `${quiz.id}-${i}`;
    const renamed = { ...quiz, id: quizId, items: quiz.items.map((it, i) => ({ ...it, id: `${quizId}-q${i + 1}`, quizId })) };
    await saveQuiz(db, renamed);
    await writeFile(path.join(REPO_ROOT, "data/fixtures", `quiz-${quizId}.json`), JSON.stringify(renamed, null, 2) + "\n");
    console.log(JSON.stringify({ quizId, title: renamed.title, items: renamed.items.length, types: renamed.items.map((i) => i.type) }));
  } else {
    throw new Error("usage: qti.ts import <zip|imscc> | export <quizId> <out> [--format qti|cc] | save <quiz.json>");
  }
} finally {
  await store.close();
}
setTimeout(() => process.exit(0), 50);
