// Bright Data Archive API leak watch (owner: D).
//
// What the API can and cannot do (docs.brightdata.com/api-reference/archive-api, read 2026-11-14):
// - POST /webarchive/search filters by time (max_age "24h") and by domain / URL patterns, NOT by page text.
// - A search returns counts and dump cost only, no URLs. URLs and HTML arrive only via a paid dump
//   (POST /webarchive/dump) delivered to S3 / GCS / Azure / a webhook. 100 searches/day are free.
// Our approach: homework sites put the question in the URL slug (chegg.com/.../average-height-young-adult-males-...),
// so we search the last 24h on study-site domains with URL regexes built from each question's distinctive words.
// A non-zero count is a CANDIDATE, not a confirmed leak, until a dump shows the page. Labelled that way everywhere.

export interface ArchiveSearchResult {
  search_id: string;
  status?: "in_progress" | "done" | "failed";
  files_count?: number;
  dump_cost_usd?: number;
  duration?: string;
  error?: string;
}

const API = "https://api.brightdata.com/webarchive";

/**
 * Study sites whose URLs slugify the question text (seen in our real findings). Quizlet (set titles) and
 * Brainly (numeric ids) don't, so this watch cannot see them; web search still covers them.
 * Archive coverage in the last 24h on 2026-11-14: quizlet ~1.4M files, brainly ~26K, studocu 121, chegg 5.
 */
export const SLUG_SITES = ["chegg.com", "coursehero.com", "studocu.com", "transtutors.com", "vaia.com", "numerade.com", "bartleby.com", "homeworklib.com"];

const STOP = new Set(
  "a an and are as at be by for from has have if in is it its of on or that the this to was what which with will how does do your you their there these those than then when where who why can could should would".split(" "),
);

/**
 * URL regex patterns for a question: its most distinctive words in order, joined by ".*", so
 * "average-height-young-adult-males" style slugs match. Numbers keep their digits ("2.5" -> "25").
 * (LIKE patterns can't start with a wildcard on this API, so we use url_regex_whitelist; it must match the
 * WHOLE path, hence the leading and trailing ".*". Verified: "comments" -> 0 pages, ".*comments.*" -> 2,023.)
 */
export function urlPatterns(stem: string, max = 2): string[] {
  const words = stem
    .toLowerCase()
    .replace(/(\d)\.(\d)/g, "$1$2")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w) && (w.length > 3 || /\d/.test(w)));
  if (words.length < 3) return [];
  const pats: string[] = [];
  // Pattern 1: first 4 distinctive words (slugs keep the question's opening).
  pats.push(`.*${words.slice(0, 4).join(".*")}.*`);
  // Pattern 2: up to 4 words with numbers or 7+ letters, in order (rarer tokens).
  const rare = words.filter((w) => /\d/.test(w) || w.length >= 7).slice(0, 4);
  if (rare.length >= 3) pats.push(`.*${rare.join(".*")}.*`);
  return [...new Set(pats)].slice(0, max);
}

export class ArchiveClient {
  constructor(private token: string) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Archive API ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  }

  /** Last-24h search on study-site domains whose URL matches one of the patterns. Polls until done (max ~90 s). */
  async search(patterns: string[], opts: { maxAge?: string; domains?: string[] } = {}): Promise<ArchiveSearchResult> {
    const first = await this.call<ArchiveSearchResult>("POST", "/search", {
      filters: { max_age: opts.maxAge ?? "24h", domain_whitelist: opts.domains ?? SLUG_SITES, url_regex_whitelist: patterns },
    });
    let r = first;
    for (let i = 0; i < 30 && r.status !== "done" && r.status !== "failed"; i++) {
      await new Promise((ok) => setTimeout(ok, 3000));
      r = await this.call<ArchiveSearchResult>("GET", `/search/${first.search_id}`);
    }
    return r;
  }
}
