// Daily leak watch (owner: B). Run once a day (systemd timer / cron):
//   pnpm --filter @unprompted/workflows leakwatch:daily [--no-archive] [--quiz id]
// 1) Re-scans every PUBLISHED quiz's delivered questions not scanned in the last 24 h (at most 2 searches each,
//    cached), writing new findings to Neon leak_finding (first_seen_at; unseen until a professor opens the alert).
// 2) D's Archive watch (Bright Data Archive, last 24 h): candidate page counts per question into
//    leak_archive_watch. Candidates, never reported as confirmed leaks.
// Prints one JSON summary line; exit code 0 unless every scan failed.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { openBranchStore } from "../db/index.js";
import { scanQuizLeaks } from "../leakwatch.js";
import { REPO_ROOT } from "../paths.js";

const { values } = parseArgs({ options: { "no-archive": { type: "boolean", default: false }, quiz: { type: "string" } } });

function archiveWatch(quizFile: string): Promise<{ items: { itemId: string; candidates: number; error?: string }[]; runAt: string } | null> {
  const dir = path.join(REPO_ROOT, "services/leakscan");
  return new Promise((resolve) => {
    const child = spawn(path.join(dir, "node_modules/.bin/tsx"), ["--env-file-if-exists=../../.env.local", "src/archive-watch.ts", "--quiz", quizFile], { cwd: dir, env: process.env, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err = (err + d).slice(-500)));
    const t = setTimeout(() => child.kill("SIGTERM"), 10 * 60_000);
    child.on("error", () => (clearTimeout(t), resolve(null)));
    child.on("close", async (code) => {
      clearTimeout(t);
      if (code !== 0) {
        console.error(`archive watch skipped: ${err.trim().split("\n").at(-1) ?? code}`);
        return resolve(null);
      }
      resolve(JSON.parse(await readFile(path.join(REPO_ROOT, "data/fixtures/archive_watch.json"), "utf8")));
    });
  });
}

const store = await openBranchStore();
const summary = { startedAt: new Date().toISOString(), quizzes: [] as unknown[], newFindings: 0, searched: 0, queries: 0, failures: 0, archive: 0 };
try {
  const db = (await store.main()).db;
  const quizzes = values.quiz
    ? [values.quiz]
    : (await db.query<{ id: string }>("select id from quiz where published order by id")).rows.map((r) => r.id);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "leakwatch-"));
  try {
    for (const quizId of quizzes) {
      try {
        const r = await scanQuizLeaks(db, quizId, { save: true, staleOnly: true });
        summary.newFindings += r.newFindings;
        summary.searched += r.searched;
        summary.queries += r.queries;
        summary.quizzes.push({ quizId, scanned: r.scanned.length, skippedFresh: r.skippedFresh.length, newFindings: r.newFindings, queryErrors: r.queryErrors });
        if (!values["no-archive"] && process.env.BRIGHTDATA_API_TOKEN?.trim() && r.items.length) {
          const f = path.join(tmp, `${quizId}.json`);
          await writeFile(f, JSON.stringify({ id: quizId, items: r.items.map((i) => ({ id: i.id, stem: i.stem })) }));
          const aw = await archiveWatch(f);
          for (const it of aw?.items ?? []) {
            await db.query("insert into leak_archive_watch (item_id, run_at, candidates, error) values ($1,$2,$3,$4) on conflict do nothing", [it.itemId, aw!.runAt, it.candidates, it.error ?? null]);
            summary.archive += it.candidates;
          }
        }
      } catch (e) {
        summary.failures++;
        summary.quizzes.push({ quizId, error: (e as Error).message.slice(0, 200) });
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  console.log(JSON.stringify(summary));
  if (quizzes.length && summary.failures === quizzes.length) process.exitCode = 1;
} finally {
  await store.close();
}
setTimeout(() => process.exit(process.exitCode ?? 0), 50);
