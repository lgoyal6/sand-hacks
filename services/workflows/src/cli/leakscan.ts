// Leak scan of a whole quiz: what students see (approved rewrites in place). Used by the studio and the auto-scan triggers.
//   tsx src/cli/leakscan.ts <quizId> [--save] [--stale-only] [--items id,id]
//     -> JSON {quizId, title, items, findings, newFindings, scanned, skippedFresh, searched, fromCache, queries, queryErrors}
// SERP budget: exact-phrase windows only, at most 2 searches per question, each question cached 24 h;
// --stale-only skips questions scanned in the last 24 h. With --save, findings go to Neon leak_finding
// (stable ids; a first sighting is unseen until a professor opens the alert) and `findings` is everything on record.
import { parseArgs } from "node:util";
import { openBranchStore } from "../db/index.js";
import { findingsFor, scanQuizLeaks } from "../leakwatch.js";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { save: { type: "boolean", default: false }, "stale-only": { type: "boolean", default: false }, items: { type: "string" } },
});
const quizId = positionals[0];
if (!quizId) throw new Error("usage: leakscan.ts <quizId> [--save] [--stale-only] [--items id,id]");

const store = await openBranchStore();
try {
  const db = (await store.main()).db;
  const r = await scanQuizLeaks(db, quizId, { save: values.save, staleOnly: values["stale-only"], itemIds: values.items?.split(",").filter(Boolean) });
  const findings = values.save ? await findingsFor(db, r.items.map((i) => i.id)) : r.findings;
  console.log(JSON.stringify({ ...r, findings }));
} finally {
  await store.close();
}
setTimeout(() => process.exit(0), 50);
