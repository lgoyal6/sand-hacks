// Data for Good leak study: how many real textbook exercises are on homework-help sites?
//   pnpm --filter @unprompted/leakscan study [--testset openstax-study] [--max-queries 200]
// Same method as kill test #3: one exact-phrase query per exercise, then a study-site keyword query only
// when that finds nothing. Stems are search strings only (never sent to an LLM). Stores snippets and links.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LeakFinding } from "@unprompted/shared";
import { BrightDataSerp, brightDataFromEnv, type SearchClient } from "./brightdata";
import { scanItem, type ItemScan } from "./scan";
import { hostOf, isStudySite } from "./sources";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

interface StudyItem {
  id: string;
  subject: string;
  book: string;
  url: string;
  stem: string;
  chapter?: string;
  number?: string;
}

/** Wilson score interval for a proportion k/n, 95%. */
function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.round(((c - r) / d) * 1000) / 10, Math.round(((c + r) / d) * 1000) / 10];
}

const STOP = new Set("a an and are as at be by for from has have if in is it of on or that the this to was what which with will how does do".split(" "));
const toks = (s: string) => s.toLowerCase().replace(/[^a-z0-9.%\s]/g, " ").split(/\s+/).filter((t) => t && !STOP.has(t));
/** Share of the exercise's content words present in the result (same rule as the app's leak radar). */
function coverage(stem: string, ev: string) {
  const ask = stem.match(/[^.?!]+[?]/g)?.pop() ?? stem;
  const q = [...new Set(toks(ask))];
  const e = new Set(toks(ev));
  return q.length ? q.filter((t) => e.has(t)).length / q.length : 0;
}
/** Snippet words that signal a worked answer is on the page (a heuristic; we never open paywalled pages). */
const ANSWER_SIGNAL = /\b(answer key|answers?|solution|solved|step[- ]by[- ]step|expert[- ]verified|explanation|show work)\b/i;

const SITE: [RegExp, string][] = [
  [/chegg\.com$/, "Chegg"],
  [/quizlet\.com$/, "Quizlet"],
  [/coursehero\.com$/, "Course Hero"],
  [/brainly\.(com|in|ph|co\.id)$/, "Brainly"],
  [/studocu\.com$/, "Studocu"],
  [/numerade\.com$/, "Numerade"],
  [/bartleby\.com$/, "bartleby"],
  [/vaia\.com$/, "Vaia"],
  [/transtutors\.com$/, "Transtutors"],
  [/reddit\.com$/, "Reddit"],
  [/gauthmath\.com$/, "Gauth"],
  [/homeworklib\.com$/, "HomeworkLib"],
];
const siteOf = (url: string) => SITE.find(([re]) => re.test(hostOf(url)))?.[1] ?? hostOf(url).replace(/^www\./, "");

/** Wraps a client with a hard query budget. */
function budgeted(c: SearchClient, max: number) {
  let used = 0;
  return {
    get used() {
      return used;
    },
    async search(q: string) {
      if (used >= max) throw new Error("query budget reached");
      used++;
      return c.search(q);
    },
  };
}

/** Exercise text lives only in the gitignored testsets/private/ (written by the plain collector). */
async function loadTestset(dir: string, name: string) {
  const { existsSync } = await import("node:fs");
  const priv = resolve(dir, "private", `${name}.json`);
  const pub = resolve(dir, `${name}.json`);
  const ts = JSON.parse(await readFile(existsSync(priv) ? priv : pub, "utf8"));
  if (ts.items.some((i: { stem?: string }) => !i.stem)) throw new Error(`Test set ${name} has no exercise text. Run scripts/recollect.py or scripts/collect_openstax.py first.`);
  return ts;
}

async function main() {
  const cfg = brightDataFromEnv();
  if (!cfg) {
    console.error("Missing BRIGHTDATA_API_TOKEN / BRIGHTDATA_SERP_ZONE. Nothing run.");
    process.exit(2);
  }
  const name = arg("testset", "openstax-study")!;
  const maxQ = Number(arg("max-queries", "200"));
  const ts = await loadTestset(resolve(HERE, "../testsets"), name);
  const items: StudyItem[] = ts.items;
  const client = budgeted(new BrightDataSerp(cfg), maxQ);
  const started = new Date();

  const scans: (ItemScan & { subject: string })[] = [];
  // Sequential on purpose: gentle on the API and the 16 s retry rule.
  for (const it of items) {
    const s = await scanItem({ id: it.id, stem: it.stem }, client, { windows: 1, fuzzy: true, threshold: 0.5 });
    scans.push({ ...s, subject: it.subject });
    process.stdout.write(`${it.id}: ${s.findings.length}\n`);
  }

  // Classify each finding: study site or not, partial (phrase only) or full, answer signal in snippet.
  type F = LeakFinding & { site: string; studySite: boolean; partial: boolean; answerSignal: boolean; subject: string; book: string; chapter: string };
  const stemById = new Map(items.map((i) => [i.id, i.stem]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const all: F[] = scans.flatMap((s) =>
    s.findings.map((f) => ({
      ...f,
      subject: s.subject,
      book: itemById.get(f.itemId)?.book ?? "",
      chapter: itemById.get(f.itemId)?.chapter ?? "",
      site: siteOf(f.url),
      studySite: isStudySite(f.url),
      partial: coverage(stemById.get(f.itemId)!, f.snippet) < 0.6,
      answerSignal: ANSWER_SIGNAL.test(f.snippet),
    })),
  );
  const leaks = all.filter((f) => f.studySite && !f.partial);
  const leakedIds = new Set(leaks.map((f) => f.itemId));
  const subjects = [...new Set(items.map((i) => i.subject))];
  const bySubject = Object.fromEntries(
    subjects.map((s) => {
      const n = items.filter((i) => i.subject === s).length;
      const k = items.filter((i) => i.subject === s && leakedIds.has(i.id)).length;
      return [s, { exercises: n, foundOnStudySites: k, pct: Math.round((k / n) * 1000) / 10 }];
    }),
  );
  const books = [...new Set(items.map((i) => i.book))];
  const byBook = Object.fromEntries(
    books.map((b) => {
      const its = items.filter((i) => i.book === b);
      const k = its.filter((i) => leakedIds.has(i.id)).length;
      return [b, { subject: its[0].subject, exercises: its.length, found: k, pct: Math.round((k / its.length) * 1000) / 10, ci95: wilson(k, its.length) }];
    }),
  );
  const chapterKey = (i: StudyItem) => `${i.book}|${i.chapter ?? "?"}`;
  const chapters = [...new Set(items.filter((i) => i.chapter).map(chapterKey))];
  const byChapter = chapters
    .map((key) => {
      const its = items.filter((i) => chapterKey(i) === key);
      const k = its.filter((i) => leakedIds.has(i.id)).length;
      const [book, chapter] = key.split("|");
      return { book, chapter, exercises: its.length, found: k, pct: Math.round((k / its.length) * 1000) / 10 };
    })
    .filter((c) => c.exercises >= 3)
    .sort((a, b) => b.pct - a.pct || b.exercises - a.exercises);
  const overallCi = wilson(leakedIds.size, items.length);
  const bySite: Record<string, { exercises: number; results: number }> = {};
  for (const f of leaks) {
    bySite[f.site] ??= { exercises: 0, results: 0 };
    bySite[f.site].results++;
  }
  for (const site of Object.keys(bySite)) bySite[site].exercises = new Set(leaks.filter((f) => f.site === site).map((f) => f.itemId)).size;
  const answerIds = new Set(leaks.filter((f) => f.answerSignal).map((f) => f.itemId));
  const hist = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((lo, i, a) => ({
    bucket: i === a.length - 1 ? "1.00" : `${lo.toFixed(2)}-${(a[i + 1] - 0.01).toFixed(2)}`,
    results: all.filter((f) => (i === a.length - 1 ? f.matchScore >= 1 : f.matchScore >= lo && f.matchScore < a[i + 1])).length,
  }));
  const errors = scans.flatMap((s) => s.queries.filter((q) => q.error));

  const summary = {
    testset: name,
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    exercises: items.length,
    queries: client.used,
    queryErrors: errors.length,
    foundOnStudySites: leakedIds.size,
    pctFoundOnStudySites: Math.round((leakedIds.size / items.length) * 1000) / 10,
    withAnswerSignalInSnippet: answerIds.size,
    ci95: overallCi,
    bySubject,
    byBook,
    byChapter,
    bySite: Object.fromEntries(Object.entries(bySite).sort((a, b) => b[1].exercises - a[1].exercises)),
    results: { total: all.length, onStudySites: all.filter((f) => f.studySite).length, partialMatchesExcluded: all.filter((f) => f.studySite && f.partial).length, otherSites: all.filter((f) => !f.studySite).length },
    matchScoreHistogram: hist,
    method:
      "One exact-phrase Google query (Bright Data SERP API) per exercise using its most distinctive 8-12 word window; if nothing matched, one keyword query restricted to study sites. A result counts as a leak when it is on a homework-help site, its title+snippet match the exercise at >= 0.5, and it contains the exercise's ask (>= 60% of its content words), so shared phrases alone don't count. Answer signal = the snippet mentions an answer, solution, solved, step-by-step, or expert-verified; we never open paywalled pages.",
    caveats: [
      "Search results vary by day and region; this is one snapshot.",
      "Match scores measure text overlap, not proof that the page holds the same question or a correct answer.",
      "Calculus has 12 exercises, not 20 (its review pages are mostly symbolic).",
      "Exercises are OpenStax excerpts (<= 125 chars); sites that paraphrase questions are undercounted.",
    ],
  };
  const out = resolve(HERE, "../results", `study-${name}-${started.toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(out, JSON.stringify({ summary, findings: all.map(({ id, itemId, subject, book, chapter, site, url, matchScore, snippet, partial, answerSignal, studySite }) => ({ id, itemId, subject, book, chapter, site, url, matchScore, snippet, partial, answerSignal, studySite })), items: items.map(({ id, subject, book, chapter, number, url }) => ({ id, subject, book, chapter, number, url })), queries: scans.flatMap((s) => s.queries) }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
