import { createHash } from "node:crypto";
import type { LeakFinding } from "@unprompted/shared";
import type { SearchClient, SerpResult } from "./brightdata.js";
import { classify, isEngine, isOrigin, isStudySite, STUDY_SITES } from "./sources.js";
import { exactWindows, keywordQuery, matchScore } from "./text.js";

export interface ScanItem {
  id: string;
  stem: string;
}

export interface ScanOptions {
  /** Minimum match score for a result to count as a leak. */
  threshold?: number;
  /** Run the keyword pass restricted to study sites when the exact pass finds nothing. */
  fuzzy?: boolean;
  now?: () => Date;
}

export interface QueryLog {
  itemId: string;
  pass: "exact" | "fuzzy";
  query: string;
  results: number;
  error?: string;
}

export interface ItemScan {
  itemId: string;
  findings: LeakFinding[];
  queries: QueryLog[];
}

const fid = (itemId: string, url: string) => "leak-" + createHash("sha1").update(itemId + "|" + url).digest("hex").slice(0, 12);

/** Keep evidence short: a snippet is evidence, a copied solution is not. */
const clip = (s: string, n = 300) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function siteFilter(): string {
  return "(" + STUDY_SITES.map((s) => `site:${s}`).join(" OR ") + ")";
}

function toFinding(item: ScanItem, query: string, r: SerpResult, score: number, now: Date): LeakFinding {
  return {
    id: fid(item.id, r.url),
    itemId: item.id,
    query,
    url: r.url,
    sourceType: classify(r.url),
    snippet: clip([r.title, r.snippet].filter(Boolean).join(" — ")),
    foundAt: now.toISOString(),
    matchScore: score,
  };
}

/**
 * Exact-phrase pass (quoted 8-12 word windows from the stem), then an optional keyword pass limited to
 * study sites. A result is a leak when it is not the question's own origin (e.g. the textbook) and its
 * title+snippet match the stem at >= threshold. Study-site hits get a small bonus, since that is where
 * answer keys live.
 */
export async function scanItem(item: ScanItem, client: SearchClient, opts: ScanOptions = {}): Promise<ItemScan> {
  const { threshold = 0.5, fuzzy = true, now = () => new Date() } = opts;
  const byUrl = new Map<string, LeakFinding>();
  const queries: QueryLog[] = [];

  const consider = (query: string, results: SerpResult[]) => {
    for (const r of results) {
      if (isOrigin(r.url) || isEngine(r.url)) continue;
      const base = matchScore(item.stem, `${r.title} ${r.snippet}`);
      const score = Math.min(1, Math.round((base + (isStudySite(r.url) ? 0.1 : 0)) * 100) / 100);
      // Off study sites (blogs, Khan Academy, lecture notes) only a near-verbatim match counts as a leak.
      if (score < (isStudySite(r.url) ? threshold : Math.max(threshold, 0.75))) continue;
      const prev = byUrl.get(r.url);
      if (!prev || prev.matchScore < score) byUrl.set(r.url, toFinding(item, query, r, score, now()));
    }
  };

  for (const w of exactWindows(item.stem)) {
    const query = `"${w}"`;
    try {
      const results = await client.search(query);
      queries.push({ itemId: item.id, pass: "exact", query, results: results.length });
      consider(query, results);
    } catch (e) {
      queries.push({ itemId: item.id, pass: "exact", query, results: 0, error: String((e as Error).message ?? e) });
    }
  }

  if (fuzzy && byUrl.size === 0) {
    const query = `${keywordQuery(item.stem)} ${siteFilter()}`;
    try {
      const results = await client.search(query);
      queries.push({ itemId: item.id, pass: "fuzzy", query, results: results.length });
      consider(query, results);
    } catch (e) {
      queries.push({ itemId: item.id, pass: "fuzzy", query, results: 0, error: String((e as Error).message ?? e) });
    }
  }

  const findings = [...byUrl.values()].sort((a, b) => b.matchScore - a.matchScore);
  return { itemId: item.id, findings, queries };
}

export async function scanAll(items: ScanItem[], client: SearchClient, opts: ScanOptions & { concurrency?: number } = {}) {
  const out: ItemScan[] = [];
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, opts.concurrency ?? 3) }, async () => {
    for (let it = queue.shift(); it; it = queue.shift()) out.push(await scanItem(it, client, opts));
  });
  await Promise.all(workers);
  const order = new Map(items.map((it, i) => [it.id, i]));
  return out.sort((a, b) => order.get(a.itemId)! - order.get(b.itemId)!);
}
