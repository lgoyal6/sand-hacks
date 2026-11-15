// Leak scan of a whole quiz (used by the studio's Canvas import flow).
//   tsx src/cli/leakscan.ts <quizId> [--save]  -> JSON {quizId, title, items, findings, searched, fromCache, queries, queryErrors}
// SERP budget: exact-phrase windows only, at most 2 searches per question, each question's result cached 24 h.
// --save writes the findings to Neon leak_finding (stable ids, so a re-scan doesn't duplicate rows).
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { openBranchStore } from "../db/index.js";
import { loadQuiz } from "../ingest/markdown.js";
import { runLeakScan } from "../steps/leakcheck.js";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { save: { type: "boolean", default: false } } });
const quizId = positionals[0];
if (!quizId) throw new Error("usage: leakscan.ts <quizId> [--save]");

const store = await openBranchStore();
try {
  const db = (await store.main()).db;
  const quiz = await loadQuiz(db, quizId);
  const items = quiz.items.filter((i) => !i.originalItemId).slice(0, 25);
  const scans = await runLeakScan(items.map((i) => ({ id: i.id, stem: i.stem })), { windows: 2, fuzzy: false });
  const findings = scans.flatMap((s) => s.findings);
  if (values.save) {
    for (const f of findings) {
      const id = `lf_${createHash("sha256").update(`${f.itemId}|${f.url}`).digest("hex").slice(0, 16)}`;
      await db.query(
        `insert into leak_finding (id, item_id, query, url, source_type, snippet, screenshot_url, found_at, match_score)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (id) do update set snippet = excluded.snippet, match_score = excluded.match_score, found_at = excluded.found_at`,
        [id, f.itemId, f.query ?? null, f.url, f.sourceType, f.snippet, f.screenshotUrl ?? null, f.foundAt, f.matchScore],
      );
    }
  }
  const scansX = scans as (typeof scans[number] & { cached?: boolean })[];
  console.log(
    JSON.stringify({
      quizId: quiz.id,
      title: quiz.title,
      items: items.map((i) => ({ id: i.id, stem: i.stem, type: i.type, objective: i.objective })),
      findings,
      searched: scansX.filter((s) => !s.cached).length,
      fromCache: scansX.filter((s) => s.cached).length,
      queries: scansX.filter((s) => !s.cached).reduce((n, s) => n + s.queries.length, 0),
      queryErrors: scansX.filter((s) => !s.cached).reduce((n, s) => n + s.queries.filter((q) => q.error).length, 0),
    }),
  );
} finally {
  await store.close();
}
setTimeout(() => process.exit(0), 50);
