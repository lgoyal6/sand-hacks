// GET /studio/api/neon -> NeonSummary (owner: B). Professors only. Read-only: lists the project's branches
// through the Neon API (cached 60 s) for the studio's "Database" line. Never creates or deletes a branch.
import { getViewer } from "@/lib/auth/server";
import { neonSummary } from "../../_lib/neon-branches";

export async function GET() {
  const viewer = await getViewer().catch(() => null);
  if (!viewer || viewer.role !== "professor") return Response.json({ error: "Professors only." }, { status: 403 });
  return Response.json(await neonSummary(), { headers: { "Cache-Control": "private, max-age=60" } });
}
