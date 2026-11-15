// Grading council for think-aloud probes.
//   tsx src/cli/council.ts <probeId>        grade one probe (used when a probe finishes)
//   tsx src/cli/council.ts --backfill       grade every completed probe that has no final score yet
//   add --force to re-grade probes that already have a score
import { openBranchStore } from "../db/index.js";
import { loadCouncilInput, runCouncil, saveCouncil } from "../council/index.js";
import { geminiModel } from "../steps/llm.js";

const args = process.argv.slice(2);
const force = args.includes("--force");
const ids = args.filter((a) => !a.startsWith("--"));
const models = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.1-pro-preview"].map((m) => geminiModel(m));
if (models.some((m) => !m)) throw new Error("The council needs three Gemini models (GMI_API_KEY or GEMINI_API_KEY).");

const store = await openBranchStore();
try {
  const db = (await store.main()).db;
  const targets = args.includes("--backfill")
    ? (await db.query<{ id: string }>(`select id from probe where completed_at is not null ${force ? "" : "and final_score is null"} order by created_at`)).rows.map((r) => r.id)
    : ids;
  for (const id of targets) {
    const input = await loadCouncilInput(db, id);
    if (!input) {
      console.log(JSON.stringify({ probeId: id, skipped: "no explanation or what-if answer to grade" }));
      continue;
    }
    const existing = (await db.query<{ final_score: number | null }>("select final_score from probe where id = $1", [id])).rows[0];
    if (existing?.final_score != null && !force) {
      console.log(JSON.stringify({ probeId: id, skipped: "already graded (use --force)" }));
      continue;
    }
    const t = Date.now();
    try {
      const r = await runCouncil(input, models as never);
      await saveCouncil(db, id, r);
      console.log(JSON.stringify({ probeId: id, final: r.finalScore, round1: r.judges.map((j) => j.round1.score), round2: r.judges.map((j) => j.round2.score), droppedQuotes: r.judges.reduce((n, j) => n + j.round1.droppedQuotes + j.round2.droppedQuotes, 0), ms: Date.now() - t }));
    } catch (e) {
      // A model failure leaves the probe ungraded (never a guessed score).
      console.log(JSON.stringify({ probeId: id, error: String((e as Error).message ?? e).slice(0, 200) }));
    }
  }
} finally {
  await store.close();
}
setTimeout(() => process.exit(0), 50);
