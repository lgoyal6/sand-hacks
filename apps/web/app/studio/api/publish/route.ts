// POST /studio/api/publish {quizId, published} (owner: B). Publishing puts a quiz on the student home and
// starts an automatic leak scan of what students will see (questions not scanned in the last 24 h).
import { getViewer } from "@/lib/auth/server";
import { neonMain } from "../../_lib/data";
import { autoScan } from "../../_lib/autoscan";

export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer || viewer.role !== "professor") return Response.json({ error: "Professors only." }, { status: 403 });
  const { quizId, published } = (await req.json().catch(() => ({}))) as { quizId?: string; published?: boolean };
  if (!quizId || !/^[\w-]+$/.test(quizId) || typeof published !== "boolean") return Response.json({ error: "quizId and published are required" }, { status: 400 });
  const db = neonMain();
  if (!db) return Response.json({ error: "Publishing needs the database (Neon)." }, { status: 503 });
  const r = await db.query("update quiz set published = $2 where id = $1 returning id", [quizId, published]);
  if (!r.rowCount) return Response.json({ error: "quiz not found" }, { status: 404 });
  if (published) autoScan(quizId, "published");
  return Response.json({ quizId, published, leakScan: published ? "started" : "none" });
}
