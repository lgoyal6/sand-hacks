// Professor deletes a think-aloud transcript (retention). Professor role only.
//   DELETE /professor/api/probes/<id>/transcript -> {ok, transcriptDeletedAt}
// Clears our copy of the student's words: the transcript, the Scribe word timestamps, and the explanation and
// follow-up answer (taken from the same transcript for voice). Scores and approval stay; the deletion time is kept.
import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/server";
import { neon } from "@/lib/db/neon";
import { ensureRetentionColumns } from "@/lib/retention";

export async function DELETE(_req: Request, ctx: RouteContext<"/professor/api/probes/[id]/transcript">) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "professor") return NextResponse.json({ error: "professors only" }, { status: 403 });
  const { id } = await ctx.params;
  if (!/^[\w-]{1,64}$/.test(id)) return NextResponse.json({ error: "bad probe id" }, { status: 400 });
  const db = neon();
  if (!db) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  if (!(await ensureRetentionColumns())) return NextResponse.json({ error: "couldn't prepare the retention columns" }, { status: 503 });
  try {
    const { rows } = await db.query<{ transcript_deleted_at: Date }>(
      `update probe set transcript = null, scribe_words_json = null, explanation = null, counterfactual_answer = null,
              transcript_deleted_at = coalesce(transcript_deleted_at, now())
        where id = $1 returning transcript_deleted_at`,
      [id],
    );
    if (!rows[0]) return NextResponse.json({ error: "probe not found" }, { status: 404 });
    return NextResponse.json({ ok: true, transcriptDeletedAt: rows[0].transcript_deleted_at.toISOString() });
  } catch (err) {
    return NextResponse.json({ error: `couldn't delete the transcript: ${(err as Error).message}` }, { status: 502 });
  }
}
