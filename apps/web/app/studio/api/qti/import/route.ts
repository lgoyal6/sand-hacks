// POST /studio/api/qti/import  (multipart: file = Canvas quiz export .zip, or a Common Cartridge .imscc such as
// a Canvas course export)  -> {quizId, title, items, skipped}
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getViewer } from "@/lib/auth/server";
import { qtiError, runQti } from "../../../_lib/qti";

export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer || viewer.role !== "professor") return Response.json({ error: "Professors only." }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Attach a Canvas export (.zip or .imscc)." }, { status: 400 });
  if (!/\.(zip|imscc)$/i.test(file.name)) return Response.json({ error: "That isn't a .zip or .imscc file. In Canvas, export the quiz as QTI, or export the course." }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return Response.json({ error: "That file is over 10 MB." }, { status: 413 });
  const tmp = path.join(os.tmpdir(), `unprompted-qti-${Date.now()}.zip`);
  await fs.writeFile(tmp, Buffer.from(await file.arrayBuffer()));
  try {
    const r = await runQti(["import", tmp]);
    if (r.code !== 0 || !r.json) return Response.json({ error: `Couldn't read that quiz: ${qtiError(r.out)}` }, { status: 422 });
    return Response.json(r.json);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
