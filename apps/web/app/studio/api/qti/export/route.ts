// GET /studio/api/qti/export?quiz=<id>[&format=qti] -> the DELIVERED quiz for Canvas (each slot's
// professor-approved variant, else the original). Default: Common Cartridge .imscc laid out like a Canvas
// course export (verified on Canvas Lite via "Canvas Course Export Package"; lands as a New Quiz with all
// questions). format=qti: the QTI 1.2 .zip for Canvas installs that offer "QTI .zip file".
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
  const format = new URL(req.url).searchParams.get("format") === "qti" ? "qti" : "cc";
  const ext = format === "cc" ? "imscc" : "zip";
  let result;
  try {
    // Recordings are per format; the QTI key stays the bare quiz id so earlier recordings still replay.
    result = await withReplay(req, "export", format === "qti" ? quiz : `${quiz}-cc`, async () => {
      const tmp = path.join(os.tmpdir(), `unprompted-export-${quiz}-${Date.now()}.${ext}`);
      try {
        const r = await runQti(["export", quiz, tmp, "--format", format]);
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
    "Content-Disposition": `attachment; filename="${quiz}-canvas${format === "qti" ? "-qti" : ""}.${ext}"`,
    "X-Export-Summary": JSON.stringify(result.data.summary),
  };
  if (result.replayedFrom) headers["X-Studio-Replay"] = result.replayedFrom;
  return new Response(Buffer.from(result.data.zipBase64, "base64"), { headers });
}
