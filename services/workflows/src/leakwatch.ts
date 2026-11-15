// Automatic leak watch (owner: B). One scan routine for every trigger: import, publish, an approved rewrite
// being delivered, and the daily re-check. Scans what students actually see (delivered_item: the approved
// rewrite where there is one), skips questions scanned in the last 24 h, and keeps the Bright Data budget
// small: exact-phrase windows only, at most 2 searches per question, each question's result cached 24 h.
import { createHash } from "node:crypto";
import type { LeakFinding } from "@unprompted/shared";
import type { Db } from "./db/types.js";
import { runLeakScan } from "./steps/leakcheck.js";

export const RESCAN_AFTER_HOURS = 24;

export interface QuizScanResult {
  quizId: string;
  title: string;
  items: { id: string; stem: string; type: string; objective: string; originalItemId: string }[];
  scanned: string[];
  skippedFresh: string[];
  findings: LeakFinding[];
  newFindings: number;
  searched: number;
  fromCache: number;
  queries: number;
  queryErrors: number;
}

type Row = { item_id: string; original_item_id: string; stem: string; type: string; objective: string; leak_scanned_at: Date | null };

/** The questions students see for a quiz (falls back to the quiz's items if the view isn't there). */
async function deliveredItems(db: Db, quizId: string): Promise<Row[]> {
  try {
    return (
      await db.query<Row>(
        `select d.item_id, d.original_item_id, d.stem, d.type, d.objective, i.leak_scanned_at
           from delivered_item d join item i on i.id = d.item_id where d.quiz_id = $1 order by d.slot`,
        [quizId],
      )
    ).rows;
  } catch {
    return (
      await db.query<Row>(
        "select id as item_id, id as original_item_id, stem, type, objective, leak_scanned_at from item where quiz_id = $1 and original_item_id is null order by id",
        [quizId],
      )
    ).rows;
  }
}

export async function scanQuizLeaks(db: Db, quizId: string, opts: { staleOnly?: boolean; save?: boolean; itemIds?: string[]; now?: Date } = {}): Promise<QuizScanResult> {
  const q = (await db.query<{ title: string }>("select title from quiz where id = $1", [quizId])).rows[0];
  if (!q) throw new Error(`quiz not found: ${quizId}`);
  const now = opts.now ?? new Date();
  const all = (await deliveredItems(db, quizId)).slice(0, 25);
  const wanted = all.filter((r) => !opts.itemIds?.length || opts.itemIds.includes(r.item_id) || opts.itemIds.includes(r.original_item_id));
  const fresh = (r: Row) => r.leak_scanned_at && now.getTime() - new Date(r.leak_scanned_at).getTime() < RESCAN_AFTER_HOURS * 3600_000;
  const todo = opts.staleOnly ? wanted.filter((r) => !fresh(r)) : wanted;
  const scans = todo.length ? await runLeakScan(todo.map((r) => ({ id: r.item_id, stem: r.stem })), { windows: 2, fuzzy: false }) : [];
  const findings = scans.flatMap((s) => s.findings);
  let newFindings = 0;
  if (opts.save) {
    for (const f of findings) {
      const id = `lf_${createHash("sha256").update(`${f.itemId}|${f.url}`).digest("hex").slice(0, 16)}`;
      // First sighting keeps found_at/first_seen_at and stays unseen; a repeat only refreshes the evidence.
      const r = await db.query<{ inserted: boolean }>(
        `insert into leak_finding (id, item_id, query, url, source_type, snippet, screenshot_url, found_at, match_score, first_seen_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         on conflict (id) do update set snippet = excluded.snippet, match_score = excluded.match_score
         returning (xmax = 0) as inserted`,
        [id, f.itemId, f.query ?? null, f.url, f.sourceType, f.snippet, f.screenshotUrl ?? null, f.foundAt, f.matchScore],
      );
      if (r.rows[0]?.inserted) newFindings++;
    }
    // Mark a question scanned only when its searches actually ran (an outage must not hide it for a day).
    const ok = scans.filter((s) => !s.queries.length || s.queries.some((x) => !x.error)).map((s) => s.itemId);
    if (ok.length) await db.query("update item set leak_scanned_at = $2 where id = any($1)", [ok, now.toISOString()]);
  }
  const sx = scans as (typeof scans[number] & { cached?: boolean })[];
  const live = sx.filter((s) => !s.cached);
  return {
    quizId,
    title: q.title,
    items: all.map((r) => ({ id: r.item_id, stem: r.stem, type: r.type, objective: r.objective, originalItemId: r.original_item_id })),
    scanned: todo.map((r) => r.item_id),
    skippedFresh: wanted.filter((r) => !todo.includes(r)).map((r) => r.item_id),
    findings,
    newFindings,
    searched: live.length,
    fromCache: sx.length - live.length,
    queries: live.reduce((n, s) => n + s.queries.length, 0),
    queryErrors: live.reduce((n, s) => n + s.queries.filter((x) => x.error).length, 0),
  };
}

/** Every finding on record for the quiz's delivered questions (for the radar after a stale-only scan). */
export async function findingsFor(db: Db, itemIds: string[]): Promise<LeakFinding[]> {
  if (!itemIds.length) return [];
  const { rows } = await db.query<{ id: string; item_id: string; query: string | null; url: string; source_type: string; snippet: string; screenshot_url: string | null; found_at: Date; match_score: number }>(
    "select id, item_id, query, url, source_type, snippet, screenshot_url, found_at, match_score from leak_finding where item_id = any($1)",
    [itemIds],
  );
  return rows.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    query: r.query ?? "",
    url: r.url,
    sourceType: r.source_type as LeakFinding["sourceType"],
    snippet: r.snippet,
    ...(r.screenshot_url ? { screenshotUrl: r.screenshot_url } : {}),
    foundAt: new Date(r.found_at).toISOString(),
    matchScore: Number(r.match_score),
  }));
}
