// POST /studio/api/appeal { attemptId } -> AppealData (owner: B). Professor-only (studio layout gate).
import { getViewer } from "@/lib/auth/server";
import { appeal } from "../../_lib/timetravel";

export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer || viewer.role !== "professor") return Response.json({ error: "Professors only." }, { status: 403 });
  const { attemptId } = (await req.json().catch(() => ({}))) as { attemptId?: string };
  if (!attemptId || !/^[\w-]+$/.test(attemptId)) return Response.json({ error: "attemptId is required" }, { status: 400 });
  try {
    return Response.json(await appeal(attemptId));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
