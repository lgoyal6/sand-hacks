import { NextResponse } from "next/server";
import { progressFor, sampleProgress } from "../../_lib/progress";
import { getViewer } from "@/lib/auth/server";

// GET /api/progress?student=<pseudonym>  or  ?attempts=<id,id,...>  (this browser's sessions)
// Returns real data when there is any; otherwise a clearly flagged sample (sample: true).
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const viewer = await getViewer();
  // Signed in: always your own progress. Otherwise (auth off) the ?student= / ?attempts= query.
  const student = viewer ? viewer.pseudonym : (sp.get("student") ?? undefined);
  const attemptIds = (sp.get("attempts") ?? "").split(",").filter((x) => /^[\w-]{1,64}$/.test(x)).slice(0, 100);
  if (student !== undefined && !/^[\w-]{1,64}$/.test(student)) return NextResponse.json({ error: "bad student" }, { status: 400 });
  const p = await progressFor({ student, attemptIds });
  // A new student still gets their real roadmap (all "Up next"); the labelled sample is only for no data at all.
  const empty = !p.topics.length && !p.review.length && !p.explainedThisWeek && !p.roadmap?.length;
  return NextResponse.json(empty ? sampleProgress() : p);
}
