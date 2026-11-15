// GET /studio/api/qti/export?quiz=<id> -> Canvas-importable QTI 1.2 zip of the DELIVERED quiz
// (each slot's professor-approved variant, else the original).
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getViewer } from "@/lib/auth/server";
import { qtiError, runQti } from "../../../_lib/qti";
import { withReplay } from "../../../_lib/replay";

export async function GET(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer || viewer.role !== "professor") return Response.json({ error: "Professors only." }, { status: 403 });
  const quiz = new URL(req.url).searchParams.get("quiz") ?? "";
  if (!/^[\w-]+$/.test(quiz)) return Response.json({ error: "quiz is required" }, { status: 400 });
  let result;
  try {
    result = await withReplay(req, "export", quiz, async () => {
      const tmp = path.join(os.tmpdir(), `unprompted-export-${quiz}-${Date.now()}.zip`);
      try {
        const r = await runQti(["export", quiz, tmp]);
        if (r.code !== 0) throw new Error(`Export failed: ${qtiError(r.out)}`);
        return { zipBase64: (await fs.readFile(tmp)).toString("base64"), summary: r.json ?? {} };
      } finally {
        await fs.rm(tmp, { force: true });
      }
    }, 20_000);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${quiz}-canvas-qti.zip"`,
    "X-Export-Summary": JSON.stringify(result.data.summary),
  };
  if (result.replayedFrom) headers["X-Studio-Replay"] = result.replayedFrom;
  return new Response(Buffer.from(result.data.zipBase64, "base64"), { headers });
}
