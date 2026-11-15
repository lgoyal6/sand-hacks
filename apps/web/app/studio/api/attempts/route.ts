// GET /studio/api/attempts?quiz=<id> -> recent attempts that can be replayed (owner: B). Professor-only.
// Pseudonyms only; never names or emails.
import { getViewer } from "@/lib/auth/server";
import { neon } from "@/lib/db/neon";

export async function GET(req: Request) {
  const v = await getViewer().catch(() => null);
  if (!v || v.role !== "professor") return Response.json({ error: "Professors only." }, { status: 403 });
  const quiz = new URL(req.url).searchParams.get("quiz") ?? "";
  if (!/^[\w-]+$/.test(quiz)) return Response.json({ error: "quiz is required" }, { status: 400 });
  const db = neon();
  if (!db) return Response.json([]);
  const { rows } = await db.query<{ id: string; student_pseudonym: string; mode: string; started_at: Date; answered: number; replayable: boolean }>(
    `select a.id, a.student_pseudonym, a.mode, a.started_at,
            (select count(*)::int from response r where r.attempt_id = a.id) as answered,
            a.quiz_snapshot_lsn is not null as replayable
       from attempt a where a.quiz_id = $1 order by a.started_at desc limit 12`,
    [quiz],
  );
  return Response.json(rows.map((r) => ({ attemptId: r.id, student: r.student_pseudonym, mode: r.mode, startedAt: new Date(r.started_at).toISOString(), answered: r.answered, replayable: r.replayable })));
}
