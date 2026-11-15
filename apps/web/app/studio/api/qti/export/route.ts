// GET /studio/api/qti/export?quiz=<id> -> Canvas-importable QTI 1.2 zip of the DELIVERED quiz
// (each slot's professor-approved variant, else the original).
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getViewer } from "@/lib/auth/server";
import { qtiError, runQti } from "../../../_lib/qti";

export async function GET(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer || viewer.role !== "professor") return Response.json({ error: "Professors only." }, { status: 403 });
  const quiz = new URL(req.url).searchParams.get("quiz") ?? "";
  if (!/^[\w-]+$/.test(quiz)) return Response.json({ error: "quiz is required" }, { status: 400 });
  const tmp = path.join(os.tmpdir(), `unprompted-export-${quiz}-${Date.now()}.zip`);
  try {
    const r = await runQti(["export", quiz, tmp]);
    if (r.code !== 0) return Response.json({ error: `Export failed: ${qtiError(r.out)}` }, { status: 500 });
    const bytes = await fs.readFile(tmp);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${quiz}-canvas-qti.zip"`,
        "X-Export-Summary": JSON.stringify(r.json ?? {}),
      },
    });
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
