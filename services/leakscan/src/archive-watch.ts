// Daily leak watch over the Bright Data Archive (last 24h). One free search per question (100/day limit).
//   pnpm --filter @unprompted/leakscan archive-watch --quiz data/fixtures/quiz-sample-stats.json
// Writes data/fixtures/archive_watch.json. A non-zero count is a CANDIDATE: the archive matched the question's
// words in a page URL on a homework site in the last 24h. Confirming it needs a dump (paid, delivered to
// S3/GCS/Azure/webhook), which is not set up; we never claim a leak from a count alone.
// Schedule: run once a day (cron or a Neon Function Trigger). Nothing is scheduled automatically.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Quiz } from "@unprompted/shared";
import { ArchiveClient, SLUG_SITES, urlPatterns } from "./archive";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");

export interface ArchiveWatchItem {
  itemId: string;
  patterns: string[];
  candidates: number;
  dumpCostUsd?: number;
  searchId?: string;
  error?: string;
}

export interface ArchiveWatchReport {
  quizId: string;
  runAt: string;
  window: "24h";
  sites: string[];
  items: ArchiveWatchItem[];
  note: string;
}

async function main() {
  const token = process.env.BRIGHTDATA_API_TOKEN;
  if (!token) {
    console.error("Missing BRIGHTDATA_API_TOKEN. Nothing run.");
    process.exit(2);
  }
  const i = process.argv.indexOf("--quiz");
  const quizPath = i >= 0 ? process.argv[i + 1] : "data/fixtures/quiz-sample-stats.json";
  const quiz: Quiz = JSON.parse(await readFile(resolve(ROOT, quizPath), "utf8"));
  const client = new ArchiveClient(token);
  const items: ArchiveWatchItem[] = [];
  for (const it of quiz.items) {
    const patterns = urlPatterns(it.stem);
    if (!patterns.length) {
      items.push({ itemId: it.id, patterns, candidates: 0, error: "question too short to build a URL pattern" });
      continue;
    }
    try {
      const r = await client.search(patterns);
      items.push({ itemId: it.id, patterns, candidates: r.files_count ?? 0, dumpCostUsd: r.dump_cost_usd, searchId: r.search_id, error: r.error });
    } catch (e) {
      items.push({ itemId: it.id, patterns, candidates: 0, error: (e as Error).message.slice(0, 200) });
    }
    console.log(`${it.id}: ${items[items.length - 1].candidates} candidate page(s)`);
  }
  const report: ArchiveWatchReport = {
    quizId: quiz.id,
    runAt: new Date().toISOString(),
    window: "24h",
    sites: SLUG_SITES,
    items,
    note: "Counts are archive pages from the last 24h whose URL contains the question's distinctive words. Candidates, not confirmed leaks.",
  };
  const out = resolve(ROOT, "data/fixtures/archive_watch.json");
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
  console.log(`wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
