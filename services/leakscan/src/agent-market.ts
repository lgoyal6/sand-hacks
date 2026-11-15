// The agent-for-hire market: public pages that advertise or discuss AI agents doing LMS coursework.
//   pnpm --filter @unprompted/leakscan agent-market [--months 12] [--max-queries 90]
// Bright Data SERP only (no Web Unlocker: it exists to get past bot protection, which we don't do).
// Stores AGGREGATES plus public URLs, hosts, platforms and the month window. No titles, snippets,
// usernames, comments or any personal data.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BrightDataSerp, brightDataFromEnv } from "./brightdata";
import { hostOf } from "./sources";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

/** Phrasings people actually use for "an AI does my LMS coursework". */
export const QUERIES = [
  "AI do my Canvas quiz",
  "AI agent that takes Canvas quizzes",
  "auto complete Canvas quiz AI extension",
  "AI take my online class for me",
  "AI agent do my homework on Blackboard",
  "AI that answers Canvas quiz automatically",
];

const PLATFORMS: [RegExp, string][] = [
  [/(^|\.)reddit\.com$/, "Reddit"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)(x\.com|twitter\.com)$/, "X"],
  [/(^|\.)(facebook\.com|instagram\.com)$/, "Facebook and Instagram"],
  [/(^|\.)linkedin\.com$/, "LinkedIn"],
  [/(^|\.)(dev\.to|substack\.com)$/, "Blogs"],
  [/(^|\.)quora\.com$/, "Quora"],
  [/(^|\.)medium\.com$/, "Medium"],
  [/(^|\.)(chromewebstore\.google\.com|chrome\.google\.com)$/, "Chrome Web Store"],
  [/(^|\.)(microsoftedge\.microsoft\.com|addons\.mozilla\.org)$/, "Browser add-on stores"],
  [/(^|\.)(apps\.apple\.com|play\.google\.com)$/, "App stores"],
  [/(^|\.)(instructure\.com|community\.canvaslms\.com)$/, "Canvas community"],
  [/(^|\.)(github\.com)$/, "GitHub"],
  [/\.(edu|ac\.uk|edu\.au)$/, "Universities"],
  [/(^|\.)(news\.ycombinator\.com|insidehighered\.com|chronicle\.com|futurism\.com|404media\.co|theverge\.com|wired\.com|boingboing\.net)$/, "News and press"],
];
export function platformOf(host: string): string {
  return PLATFORMS.find(([re]) => re.test(host))?.[1] ?? "Websites and services";
}

function monthWindows(n: number, now = new Date()) {
  const out: { label: string; tbs: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const f = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
    out.push({ label: start.toISOString().slice(0, 7), tbs: `cdr:1,cd_min:${f(start)},cd_max:${f(end)}` });
  }
  return out;
}

async function main() {
  const cfg = brightDataFromEnv();
  if (!cfg) {
    console.error("Missing BRIGHTDATA_API_TOKEN / BRIGHTDATA_SERP_ZONE. Nothing run.");
    process.exit(2);
  }
  const from = arg("from", "");
  const months = Number(arg("months", "12"));
  const maxQ = Number(arg("max-queries", "90"));
  const serp = new BrightDataSerp(cfg, { retries: 2 });
  let windows = monthWindows(months);
  type Row = { url: string; host: string; platform: string; month: string; query: number };
  const rows: Row[] = [];
  let calls = 0;
  let errors = 0;
  let started = new Date();
  if (from) {
    // Re-aggregate a previous run (e.g. after fixing the platform classifier). No new searches.
    const prev = JSON.parse(await readFile(resolve(ROOT, from), "utf8"));
    for (const p of prev.pages) rows.push({ ...p, platform: platformOf(p.host), query: -1 });
    calls = prev.summary.serpCalls;
    errors = prev.summary.queryErrors;
    started = new Date(prev.summary.collected);
    windows = prev.summary.months.map((m: string) => ({ label: m, tbs: "" }));
  }
  for (const w of from ? [] : windows) {
    for (const [qi, q] of QUERIES.entries()) {
      if (calls >= maxQ) break;
      calls++;
      try {
        const res = await serp.searchWith(q, { tbs: w.tbs });
        for (const r of res) {
          const host = hostOf(r.url).replace(/^www\./, "");
          if (!host || /google\./.test(host)) continue;
          rows.push({ url: r.url.split("#")[0], host, platform: platformOf(host), month: w.label, query: qi });
        }
      } catch {
        errors++;
      }
    }
    process.stdout.write(`${w.label}: ${rows.length} rows so far, ${calls} calls\n`);
  }
  // A page counts once per month even if several phrasings found it.
  const uniq = new Map<string, Row>();
  for (const r of rows) uniq.set(`${r.month}|${r.url}`, r);
  const pages = [...uniq.values()];
  const urls = new Set(pages.map((p) => p.url));
  const byMonth = windows.map((w) => ({ month: w.label, pages: pages.filter((p) => p.month === w.label).length }));
  const byPlatform: Record<string, number> = {};
  for (const u of urls) {
    const p = pages.find((x) => x.url === u)!;
    byPlatform[p.platform] = (byPlatform[p.platform] ?? 0) + 1;
  }
  const serviceHosts: Record<string, number> = {};
  for (const u of urls) {
    const p = pages.find((x) => x.url === u)!;
    if (p.platform === "Websites and services" || p.platform === "Chrome Web Store" || p.platform === "Browser add-on stores") serviceHosts[p.host] = (serviceHosts[p.host] ?? 0) + 1;
  }
  const summary = {
    collected: started.toISOString(),
    months: windows.map((w) => w.label),
    queries: QUERIES,
    serpCalls: calls,
    queryErrors: errors,
    uniquePages: urls.size,
    byMonth,
    byPlatform: Object.fromEntries(Object.entries(byPlatform).sort((a, b) => b[1] - a[1])),
    topServiceHosts: Object.entries(serviceHosts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([host, n]) => ({ host, pages: n })),
    method:
      "Six phrasings of 'an AI does my LMS coursework' searched on Google via the Bright Data SERP API, one search per phrasing per calendar month (Google's custom date range), top 20 results each. A page counts once per month. Platform is classified from the host name.",
    caveats: [
      "Search results are not a census: this samples what Google surfaces for these phrasings.",
      "Google's date filter reflects when Google dated the page, which can differ from when it was posted.",
      "Pages discuss as well as advertise; a Reddit thread complaining about these tools counts the same as an ad.",
      "Recent months can look smaller because Google has had less time to index them.",
      `${errors} of ${calls} searches failed and returned nothing, so every month is undercounted somewhat.`,
    ],
  };
  const out = { summary, pages: pages.map(({ url, host, platform, month }) => ({ url, host, platform, month })) };
  const stamp = started.toISOString().replace(/[:.]/g, "-");
  await writeFile(resolve(HERE, "../results", `agent-market-${stamp}.json`), JSON.stringify(out, null, 2));
  await mkdir(resolve(ROOT, "data/open"), { recursive: true });
  await writeFile(resolve(ROOT, "data/open/agent-market-2026-11.json"), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
