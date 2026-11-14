// Text helpers for building leak queries and scoring matches. No network, no LLMs.

const STOPWORDS = new Set(
  (
    "a an and are as at be been being but by can could did do does for from had has have he her his how i if in into is it its " +
    "may might more most must no not of on or our she should so some such than that the their them then there these they this " +
    "those to was we were what when where which while who whom why will with would you your about after again all also any " +
    "because before between both each few just only other over same very"
  ).split(" "),
);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9%.'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function words(text: string): string[] {
  // Keep the original casing and punctuation of each word for exact-phrase queries.
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .map((t) => t.replace(/^[.'-]+|[.'-]+$/g, ""))
    .filter(Boolean);
}

/** How distinctive a window is: content words, numbers and capitalised words count; stopwords don't. */
function distinctiveness(ws: string[]): number {
  let s = 0;
  for (const w of ws) {
    const t = normalize(w).replace(/[.'-]/g, "");
    if (!t || STOPWORDS.has(t)) continue;
    s += 1;
    if (/\d/.test(t)) s += 1.5; // numbers make a stem much more specific
    if (/^[A-Z]/.test(w)) s += 0.5;
    if (t.length >= 8) s += 0.5;
  }
  return s / ws.length;
}

/**
 * Exact-phrase windows of `min`..`max` words (build plan 4.7), most distinctive first and non-overlapping.
 * Stems shorter than `min` words are returned whole.
 */
export function exactWindows(stem: string, opts: { min?: number; max?: number; count?: number } = {}): string[] {
  const { min = 8, max = 12, count = 2 } = opts;
  const ws = words(stem);
  if (ws.length <= max) return ws.length ? [cleanEdges(ws.join(" "))] : [];
  const size = Math.max(min, Math.min(max, 10));
  const candidates: { start: number; score: number }[] = [];
  for (let i = 0; i + size <= ws.length; i++) candidates.push({ start: i, score: distinctiveness(ws.slice(i, i + size)) });
  candidates.sort((a, b) => b.score - a.score || a.start - b.start);
  const chosen: number[] = [];
  for (const c of candidates) {
    if (chosen.every((s) => Math.abs(s - c.start) >= size)) chosen.push(c.start);
    if (chosen.length >= count) break;
  }
  return chosen.sort((a, b) => a - b).map((s) => cleanEdges(ws.slice(s, s + size).join(" ")));
}

function cleanEdges(s: string) {
  // Quotes inside an exact-phrase query break it; strip edge punctuation that search engines ignore anyway.
  return s.replace(/["“”]/g, "").replace(/^[^\w%]+|[^\w%?]+$/g, "");
}

/** Keyword query for the fuzzy pass: the most specific content words and every number. */
export function keywordQuery(stem: string, max = 8): string {
  const seen = new Set<string>();
  const out: string[] = [];
  const ranked = tokens(stem)
    .filter((t) => !STOPWORDS.has(t) && (t.length > 2 || /\d/.test(t)))
    .map((t, i) => ({ t, i, score: (/\d/.test(t) ? 3 : 0) + Math.min(t.length, 10) / 10 }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  for (const { t } of ranked) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out.join(" ");
}

function shingles(ts: string[], n: number): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i + n <= ts.length; i++) s.add(ts.slice(i, i + n).join(" "));
  return s;
}

/**
 * How much of the question text appears in a search result (title + snippet), 0..1.
 * Max of: 3-word-shingle containment (word order matters) and the longest exact window found.
 * Search snippets are short, so we measure containment of the snippet's overlap against the
 * shorter of the two texts, not against the full stem.
 */
export function matchScore(stem: string, evidence: string): number {
  const a = tokens(stem);
  const b = tokens(evidence);
  if (a.length < 3 || b.length < 3) return 0;
  const sa = shingles(a, 3);
  const sb = shingles(b, 3);
  let hit = 0;
  for (const x of sb) if (sa.has(x)) hit++;
  const denom = Math.min(sa.size, sb.size);
  const containment = denom ? hit / denom : 0;
  // Longest run of consecutive stem words that appears in the evidence.
  const bText = " " + b.join(" ") + " ";
  let longest = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + longest + 1; j <= a.length; j++) {
      if (bText.includes(" " + a.slice(i, j).join(" ") + " ")) longest = j - i;
      else break;
    }
  }
  const run = Math.min(1, longest / Math.min(12, a.length));
  return Math.round(Math.max(containment, run) * 100) / 100;
}
