// POST /studio/api/coursescan/rewrite {row: {id, stem}, answer, skill?} -> {quizId, itemId}  (owner: B)
// A posted course problem has no answer key, and the rewrite's first check is "the solver reproduces the key
// 3 times". So the professor supplies the correct answer; the problem is saved as a one-question quiz
// (sourceFormat course_site) and the studio then runs the usual rewrite on it (leaked=1).
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Quiz } from "@unprompted/shared";
import { getViewer } from "@/lib/auth/server";
import { runQti } from "../../../_lib/qti";

export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer || viewer.role !== "professor") return Response.json({ error: "Professors only." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { row?: { id?: string; stem?: string }; answer?: string; skill?: string };
  const id = b.row?.id ?? "";
  const stem = (b.row?.stem ?? "").trim();
  const answer = (b.answer ?? "").trim();
  if (!/^course-[\w-]+$/.test(id) || !stem || stem.length > 4000) return Response.json({ error: "That problem isn't from a course scan." }, { status: 400 });
  if (!answer || answer.length > 500) return Response.json({ error: "Enter the correct answer first." }, { status: 400 });
  const numeric = /^-?\d+(\.\d+)?(\/\d+)?%?$/.test(answer.replace(/[,\s]/g, ""));
  const quiz: Quiz = {
    id,
    courseId: "sandbox-course",
    title: `Course site problem ${id.split("-").at(-1)}`,
    sourceFormat: "course_site",
    items: [
      {
        id: `${id}-q1`,
        quizId: id,
        stem,
        type: numeric ? "numeric" : "short",
        answerKey: answer,
        objective: (b.skill ?? "").trim().slice(0, 200) || "the same skill as the posted problem",
        originalItemId: null,
      },
    ],
  };
  const tmp = path.join(os.tmpdir(), `unprompted-course-${Date.now()}.json`);
  await fs.writeFile(tmp, JSON.stringify(quiz));
  try {
    const r = await runQti(["save", tmp]);
    const j = r.json as { quizId?: string } | null;
    if (r.code !== 0 || !j?.quizId) return Response.json({ error: "Couldn't save that problem." }, { status: 500 });
    return Response.json({ quizId: j.quizId, itemId: `${j.quizId}-q1` });
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
