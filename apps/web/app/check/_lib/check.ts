// Public "Is my question leaked?" checker (owner: D). Server only.
// Guardrails: <= 4 Bright Data SERP calls per check (retries included), 5 checks per IP per 10 minutes,
// identical questions served from a 1-hour cache keyed by a SHA-256 hash (the text itself is never stored),
// and only public links, site names and match strength go back to the browser: no snippets, never solutions.
import "server-only";
import { createHash } from "node:crypto";
import { BrightDataSerp, brightDataFromEnv, exactWindows, hostOf, isStudySite, keywordQuery, matchScore, siteFilter } from "@unprompted/leakscan";

export const MAX_SERP_CALLS = 4;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const CACHE_MS = 60 * 60 * 1000;

import type { CheckEvent } from "./types";
export type { CheckEvent };

const SITE_NAMES: [RegExp, string][] = [
  [/quizlet\.com$/, "Quizlet"],
  [/brainly\./, "Brainly"],
  [/vaia\.com$/, "Vaia"],
  [/chegg\.com$/, "Chegg"],
  [/studocu\.com$/, "Studocu"],
  [/coursehero\.com$/, "Course Hero"],
  [/numerade\.com$/, "Numerade"],
  [/bartleby\.com$/, "bartleby"],
  [/transtutors\.com$/, "Transtutors"],
  [/reddit\.com$/, "Reddit"],
  [/gauthmath\.com$/, "Gauth"],
  [/homeworklib\.com$/, "HomeworkLib"],
];
export const siteName = (host: string) => SITE_NAMES.find(([re]) => re.test(host))?.[1] ?? host.replace(/^www\./, "");

const STOP = new Set("a an and are as at be by for from has have if in is it of on or that the this to was what which with will how does do".split(" "));
const toks = (s: string) => s.toLowerCase().replace(/[^a-z0-9.%\s]/g, " ").split(/\s+/).filter((t) => t && !STOP.has(t));
/** Same rule as the leak radar: a hit must contain the question's ask, not just a shared phrase. */
function askCoverage(q: string, evidence: string) {
  const ask = q.match(/[^.?!]+[?]/g)?.pop() ?? q;
  const qt = [...new Set(toks(ask))];
  const e = new Set(toks(evidence));
  return qt.length ? qt.filter((t) => e.has(t)).length / qt.length : 0;
}

export function normalizeQuestion(raw: string) {
  return raw.replace(/\s+/g, " ").trim();
}
export const hashQuestion = (q: string) => createHash("sha256").update(q.toLowerCase()).digest("hex");

// In-memory guardrails (one server process; fine for the demo, swap for a shared store when deployed).
const hits = new Map<string, number[]>();
const cache = new Map<string, { at: number; events: CheckEvent[] }>();

export function rateLimit(ip: string): { ok: boolean; retryInSec: number } {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) return { ok: false, retryInSec: Math.ceil((RATE_WINDOW_MS - (now - list[0])) / 1000) };
  list.push(now);
  hits.set(ip, list);
  return { ok: true, retryInSec: 0 };
}

export function cached(hash: string): CheckEvent[] | null {
  const c = cache.get(hash);
  if (!c || Date.now() - c.at > CACHE_MS) return null;
  return c.events;
}

/** Runs the check, calling `emit` as results stream in. Returns all events for the cache. */
export async function runCheck(question: string, emit: (e: CheckEvent) => void): Promise<CheckEvent[]> {
  const events: CheckEvent[] = [];
  const send = (e: CheckEvent) => {
    events.push(e);
    emit(e);
  };
  const cfg = brightDataFromEnv();
  if (!cfg) {
    send({ type: "error", message: "The web search isn't configured on this server." });
    return events;
  }
  const client = new BrightDataSerp(cfg, { retries: 1 });
  const exact = exactWindows(question, { count: 2 }).map((w) => ({ q: `"${w}"`, kind: "exact" as const }));
  const plan = [...exact, { q: `${keywordQuery(question)} ${siteFilter()}`, kind: "keyword" as const }].slice(0, MAX_SERP_CALLS);
  send({ type: "start", queries: plan.length, cached: false });

  const seen = new Set<string>();
  const sites = new Set<string>();
  let calls = 0;
  for (const [i, step] of plan.entries()) {
    // Skip the keyword fallback when the exact pass already found the question.
    if (step.kind === "keyword" && sites.size > 0) break;
    send({ type: "query", n: i + 1, of: plan.length, kind: step.kind });
    let results: Awaited<ReturnType<BrightDataSerp["search"]>> = [];
    try {
      calls++;
      results = await client.search(step.q);
    } catch {
      continue; // one failed query doesn't end the check; the report says how many ran
    }
    for (const r of results) {
      if (!isStudySite(r.url) || seen.has(r.url)) continue;
      const evidence = `${r.title} ${r.snippet}`;
      const score = matchScore(question, evidence);
      if (score < 0.5) continue;
      seen.add(r.url);
      const host = hostOf(r.url);
      const partial = askCoverage(question, evidence) < 0.6;
      if (!partial) sites.add(siteName(host));
      send({ type: "hit", site: siteName(host), host, url: r.url, matchScore: score, partial });
    }
  }
  send({ type: "done", found: sites.size > 0, sites: [...sites], serpCalls: calls });
  return events;
}

export function remember(hash: string, events: CheckEvent[]) {
  if (events.some((e) => e.type === "error")) return;
  cache.set(hash, { at: Date.now(), events });
}
