// Leak radar data (owner: D). Plain module, safe on server and client.
// buildLeakRadar() turns leak_finding rows (search and archive) into the per-question view the LeakRadar
// card renders, in the chat (B's Leak scout) and on /professor.
import type { LeakFinding, Quiz } from "@unprompted/shared";

export interface LeakHit {
  url: string;
  host: string;
  sourceType: string;
  matchScore: number;
  snippet: string;
  screenshotUrl?: string;
  via: "search" | "archive";
  foundAt: string;
  /** The result shares a phrase but not the question's ask: shown as "partial, check it". */
  partial: boolean;
  /** Same as `partial`, named for B's Leak scout schema. */
  likelyFalsePositive: boolean;
  /** Why it's flagged (only when likelyFalsePositive). */
  reason?: string;
}

export interface LeakRadarItem {
  itemId: string;
  label: string;
  topic: string;
  hits: LeakHit[];
  newSinceRelease: boolean;
}

export interface LeakRadarData {
  quizId: string;
  quizTitle: string;
  itemsTotal: number;
  items: LeakRadarItem[];
  releasedAt?: string;
  lastScanAt?: string;
  archiveWatch: { status: "on" | "off"; lastRunAt?: string };
}

const STOP = new Set("a an and are as at be by for from has have if in is it of on or that the this to was what which with will".split(" "));
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9.%\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t && !STOP.has(t));

/** Share of the question's content words that appear in the evidence. */
export function coverage(stem: string, evidence: string): number {
  const q = [...new Set(tokens(stem))];
  if (!q.length) return 0;
  const e = new Set(tokens(evidence));
  return q.filter((t) => e.has(t)).length / q.length;
}

/** The question's actual ask: its last sentence ending in "?", else the whole stem. */
export function askOf(stem: string): string {
  const parts = stem.match(/[^.?!]+[?]/g);
  return parts?.length ? parts[parts.length - 1] : stem;
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Short topic from the item's objective, else the first words of the stem. */
function topicOf(it: Quiz["items"][number]) {
  if (it.objective) return it.objective.charAt(0).toUpperCase() + it.objective.slice(1);
  return it.stem.split(" ").slice(0, 7).join(" ") + "…";
}

export function buildLeakRadar(
  quiz: Pick<Quiz, "id" | "title" | "items">,
  findings: (LeakFinding & { via?: "search" | "archive" })[],
  opts: { releasedAt?: string; archiveWatch?: LeakRadarData["archiveWatch"] } = {},
): LeakRadarData {
  const byItem = new Map<string, LeakHit[]>();
  let lastScanAt: string | undefined;
  const stems = new Map(quiz.items.map((i) => [i.id, i.stem]));
  for (const f of findings) {
    if (!stems.has(f.itemId)) continue;
    const via = f.via ?? (f.query?.startsWith("archive:") ? "archive" : "search");
    const hit: LeakHit = {
      url: f.url,
      host: host(f.url),
      sourceType: f.sourceType,
      matchScore: f.matchScore,
      snippet: f.snippet,
      screenshotUrl: f.screenshotUrl,
      via,
      foundAt: f.foundAt,
      // A shared phrase alone isn't a leak: the result must also contain the question's ask.
      partial: false,
      likelyFalsePositive: false,
    };
    const askCov = coverage(askOf(stems.get(f.itemId)!), f.snippet);
    if (askCov < 0.6) {
      hit.partial = hit.likelyFalsePositive = true;
      hit.reason = `Shares a phrase with the question, but only ${Math.round(askCov * 100)}% of what it asks appears in the result.`;
    }
    byItem.set(f.itemId, [...(byItem.get(f.itemId) ?? []), hit]);
    if (!lastScanAt || f.foundAt > lastScanAt) lastScanAt = f.foundAt;
  }
  const items = quiz.items.map((it, i) => {
    const hits = (byItem.get(it.id) ?? []).sort((a, b) => Number(a.partial) - Number(b.partial) || b.matchScore - a.matchScore);
    return {
      itemId: it.id,
      label: `Q${i + 1}`,
      topic: topicOf(it),
      hits,
      newSinceRelease: !!opts.releasedAt && hits.some((h) => h.foundAt > opts.releasedAt!),
    };
  });
  return {
    quizId: quiz.id,
    quizTitle: quiz.title,
    itemsTotal: quiz.items.length,
    items,
    releasedAt: opts.releasedAt,
    lastScanAt,
    archiveWatch: opts.archiveWatch ?? { status: "off" },
  };
}

/** Questions with at least one hit that isn't partial. */
export function onlineCount(d: LeakRadarData) {
  return d.items.filter((i) => i.hits.some((h) => !h.partial)).length;
}
