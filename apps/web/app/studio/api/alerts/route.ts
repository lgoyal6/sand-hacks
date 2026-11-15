// Leak alerts (owner: B; D renders them as a badge and banner). Professor only.
//   GET  /studio/api/alerts            -> {unseen, classes: [{courseId, courseTitle, alerts: LeakAlert[]}]}
//   POST /studio/api/alerts {ids} | {all: true}   -> marks them seen (call it when the professor opens them)
// An alert is a first sighting of a question students see (the approved rewrite, if any) on the open web,
// found by an automatic scan (import, publish, rewrite delivered) or the daily leak watch. Phrase-only
// matches (the result doesn't contain the question's ask, D's radar rule) are not alerts.
import { getViewer } from "@/lib/auth/server";
import { askOf, coverage } from "@/components/dashboard/leak-radar-data";
import { neonMain } from "../../_lib/data";

export interface LeakAlert {
  id: string;
  quizId: string;
  quizTitle: string;
  itemId: string;
  /** The slot's original item: the target for "Write a new version". */
  slotItemId: string;
  label: string;
  site: string;
  url: string;
  matchScore: number;
  firstSeenAt: string;
  /** e.g. "Q3 of Stats Quiz 1 appeared on quizlet.com today" */
  message: string;
  /** GET /studio/api/run?mode=live&quiz=...&items=...&n=2&attack=0&leaked=1 */
  rewrite: { quizId: string; itemId: string; runUrl: string };
}

type Row = {
  id: string; item_id: string; url: string; snippet: string; match_score: number; first_seen_at: Date;
  stem: string; original_item_id: string | null; quiz_id: string; quiz_title: string; course_id: string | null; course_title: string | null;
};

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};
function when(d: Date, now = new Date()) {
  const day = (x: Date) => x.toISOString().slice(0, 10);
  if (day(d) === day(now)) return "today";
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return "yesterday";
  return `on ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}
const displayTitle = (t: string) => t.replace(/^Sample quiz:\s*/i, "").replace(/\s*\([^)]*\)\s*$/, "");

async function professor() {
  const viewer = await getViewer().catch(() => null);
  return viewer?.role === "professor";
}

export async function GET() {
  if (!(await professor())) return Response.json({ error: "Professors only." }, { status: 403 });
  const db = neonMain();
  if (!db) return Response.json({ unseen: 0, classes: [], note: "Alerts need the database (Neon)." });
  const { rows } = await db.query<Row>(
    `select f.id, f.item_id, f.url, f.snippet, f.match_score, coalesce(f.first_seen_at, f.found_at) as first_seen_at,
            i.stem, i.original_item_id, q.id as quiz_id, q.title as quiz_title, q.course_id, c.title as course_title
       from leak_finding f
       join item i on i.id = f.item_id
       join quiz q on q.id = i.quiz_id
       left join course c on c.id = q.course_id
      where f.seen_at is null
      order by coalesce(f.first_seen_at, f.found_at) desc
      limit 200`,
  );
  const byCourse = new Map<string, { courseId: string; courseTitle: string; alerts: LeakAlert[] }>();
  for (const r of rows) {
    if (coverage(askOf(r.stem), r.snippet) < 0.6) continue; // phrase-only: worth a look on the radar, not an alert
    const slot = r.original_item_id ?? r.item_id;
    const label = `Q${slot.match(/-q(\d+)$/)?.[1] ?? "?"}`;
    const title = displayTitle(r.quiz_title);
    const site = host(r.url);
    const firstSeen = new Date(r.first_seen_at);
    const key = r.course_id ?? "none";
    const g = byCourse.get(key) ?? { courseId: key, courseTitle: r.course_title ?? key, alerts: [] };
    g.alerts.push({
      id: r.id,
      quizId: r.quiz_id,
      quizTitle: title,
      itemId: r.item_id,
      slotItemId: slot,
      label,
      site,
      url: r.url,
      matchScore: Number(r.match_score),
      firstSeenAt: firstSeen.toISOString(),
      message: `${label} of ${title} appeared on ${site} ${when(firstSeen)}`,
      rewrite: {
        quizId: r.quiz_id,
        itemId: slot,
        runUrl: `/studio/api/run?mode=live&quiz=${encodeURIComponent(r.quiz_id)}&items=${encodeURIComponent(slot)}&n=2&attack=0&leaked=1`,
      },
    });
    byCourse.set(key, g);
  }
  const classes = [...byCourse.values()];
  return Response.json({ unseen: classes.reduce((n, c) => n + c.alerts.length, 0), classes });
}

export async function POST(req: Request) {
  if (!(await professor())) return Response.json({ error: "Professors only." }, { status: 403 });
  const db = neonMain();
  if (!db) return Response.json({ error: "Alerts need the database (Neon)." }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as { ids?: unknown; all?: boolean };
  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string" && /^[\w-]+$/.test(x)).slice(0, 500) : [];
  if (!b.all && !ids.length) return Response.json({ error: "ids or all is required" }, { status: 400 });
  const r = b.all
    ? await db.query("update leak_finding set seen_at = now() where seen_at is null")
    : await db.query("update leak_finding set seen_at = now() where seen_at is null and id = any($1)", [ids]);
  return Response.json({ marked: r.rowCount ?? 0 });
}
