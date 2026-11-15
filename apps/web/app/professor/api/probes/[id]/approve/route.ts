// Professor approves (or un-approves) the council's think-aloud score (owner: D). Professor role only.
// Approval is the human step: nothing reaches a grade without it.
import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/server";
import { neon } from "@/lib/db/neon";

export async function POST(req: Request, ctx: RouteContext<"/professor/api/probes/[id]/approve">) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "professor") return NextResponse.json({ error: "professors only" }, { status: 403 });
  const { id } = await ctx.params;
  if (!/^[\w-]{1,64}$/.test(id)) return NextResponse.json({ error: "bad probe id" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { approved?: unknown };
  const approved = body.approved !== false;
  const db = neon();
  if (!db) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  const { rows } = await db.query<{ professor_approved: boolean; final_score: number | null }>(
    "update probe set professor_approved = $2 where id = $1 and (final_score is not null or $2 = false) returning professor_approved, final_score",
    [id, approved],
  );
  if (!rows[0]) return NextResponse.json({ error: "probe not found or not scored yet" }, { status: 404 });
  return NextResponse.json({ ok: true, approved: rows[0].professor_approved });
}
