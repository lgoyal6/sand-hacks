// Leak scan CLI.
//   pnpm --filter @unprompted/leakscan scan --testset openstax-is2e      Phase 0 kill test #3 -> results/killtest-<ts>.json
//   pnpm --filter @unprompted/leakscan scan --quiz data/fixtures/quiz-sample-stats.json   -> data/fixtures/leaks.json
// Options: --screenshots (Browser API, never solves CAPTCHAs), --captcha-off-at-zone (attest the zone's CAPTCHA
//   Solver is OFF in the Bright Data dashboard, when the zone rejects the per-session CDP switch), --threshold 0.5, --no-fuzzy
//   --rescreen re-screenshots the findings already in data/fixtures/leaks.json without new searches
//   ... scan --quiz - --json [--max-items 25]   PURE mode: Quiz JSON on stdin, ItemScan[] JSON on stdout,
//                                             no files written, logs on stderr (for A's course-site scan)
// Without BRIGHTDATA_API_TOKEN + BRIGHTDATA_SERP_ZONE it exits non-zero. It never writes made-up findings.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LeakFinding, Quiz } from "@unprompted/shared";
import { BrightDataSerp, brightDataFromEnv, screenshot } from "./brightdata";
import { scanAll, type ScanItem } from "./scan";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

/** Exercise text lives only in the gitignored testsets/private/ (written by the plain collector). */
async function loadTestset(dir: string, name: string) {
  const { existsSync } = await import("node:fs");
  const priv = resolve(dir, "private", `${name}.json`);
  const pub = resolve(dir, `${name}.json`);
  const ts = JSON.parse(await readFile(existsSync(priv) ? priv : pub, "utf8"));
  if (ts.items.some((i: { stem?: string }) => !i.stem)) throw new Error(`Test set ${name} has no exercise text. Run scripts/recollect.py or scripts/collect_openstax.py first.`);
  return ts;
}

async function readStdin(): Promise<string> {
  let s = "";
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

async function main() {
  const cfg = brightDataFromEnv();
  if (!cfg) {
    console.error("Missing BRIGHTDATA_API_TOKEN or BRIGHTDATA_SERP_ZONE in .env.local. No scan run, nothing written.");
    process.exit(2);
  }

  const testset = arg("testset");
  const quizPath = arg("quiz");
  let items: ScanItem[];
  let source: string;
  if (testset) {
    const ts = await loadTestset(resolve(HERE, "../testsets"), testset);
    items = ts.items.map((i: { id: string; stem: string }) => ({ id: i.id, stem: i.stem }));
    source = `testset:${testset}`;
  } else if (quizPath) {
    const raw = quizPath === "-" ? await readStdin() : await readFile(resolve(ROOT, quizPath), "utf8");
    const quiz: Quiz = JSON.parse(raw);
    items = quiz.items.map((i) => ({ id: i.id, stem: i.stem }));
    source = `quiz:${quiz.id}`;
  } else {
    console.error("Pass --testset <name> or --quiz <path>.");
    process.exit(2);
  }

  const maxItems = Number(arg("max-items") ?? 0);
  if (maxItems > 0) items = items.slice(0, maxItems);
  const pure = flag("json");
  const threshold = Number(arg("threshold") ?? 0.5);
  const client = new BrightDataSerp(cfg);
  const started = new Date();
  const scans = await scanAll(items, client, { threshold, fuzzy: !flag("no-fuzzy") });
  if (pure) {
    process.stdout.write(JSON.stringify(scans) + "\n");
    console.error(`scanned ${items.length} item(s), ${scans.reduce((n, s) => n + s.queries.length, 0)} SERP call(s)`);
    return;
  }
  const findings: LeakFinding[] = scans.flatMap((s) => s.findings);

  if (flag("screenshots")) {
    if (!cfg.browserWss) console.warn("No Browser API endpoint configured; skipping screenshots.");
    else {
      const dir = resolve(ROOT, "data/leak-screens");
      await mkdir(dir, { recursive: true });
      // One screenshot per item (its best match) keeps Browser API usage small.
      const best = new Map<string, LeakFinding>();
      for (const f of findings) if (!best.has(f.itemId)) best.set(f.itemId, f);
      for (const f of best.values()) {
        const out = resolve(dir, `${f.id}.png`);
        try {
          const r = await screenshot(cfg.browserWss, f.url, out, { captchaOffAtZone: flag("captcha-off-at-zone") });
          if (r.ok) f.screenshotUrl = `/professor/screens/${f.id}.png`;
          else console.warn(`screenshot skipped for ${f.url}: ${r.reason}`);
        } catch (e) {
          console.warn(`screenshot failed for ${f.url}: ${(e as Error).message}`);
        }
      }
    }
  }

  const leakedItems = new Set(findings.map((f) => f.itemId));
  const errors = scans.flatMap((s) => s.queries.filter((q) => q.error));
  const summary = {
    source,
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    threshold,
    items: items.length,
    itemsWithLeaks: leakedItems.size,
    findings: findings.length,
    queries: scans.reduce((n, s) => n + s.queries.length, 0),
    queryErrors: errors.length,
    killTestPassed: leakedItems.size >= 1,
  };
  console.log(JSON.stringify(summary, null, 2));
  for (const s of scans) {
    const top = s.findings[0];
    console.log(`${s.itemId}: ${s.findings.length} finding(s)${top ? `, top ${top.matchScore} ${top.sourceType} ${top.url}` : ""}`);
  }
  if (errors.length) console.warn("Query errors:", errors.slice(0, 3));

  if (testset) {
    const out = resolve(HERE, "../results", `killtest-${testset}-${started.toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(out, JSON.stringify({ summary, scans }, null, 2));
    console.log(`wrote ${out}`);
  } else {
    const out = resolve(ROOT, "data/fixtures/leaks.json");
    await writeFile(out, JSON.stringify(findings, null, 2) + "\n");
    console.log(`wrote ${out} (${findings.length} findings)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
