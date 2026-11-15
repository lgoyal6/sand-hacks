// Connect Canvas (owner: B). Professor-only. The token is never returned.
//   GET    /studio/api/canvas                         -> {connected, source?, baseUrl?}
//   POST   /studio/api/canvas {action:"connect", baseUrl, token}
//   POST   /studio/api/canvas {action:"courses"} | {action:"quizzes", courseId}
//   POST   /studio/api/canvas {action:"import", courseId, quizId}   -> saved to Neon as our quiz
//   POST   /studio/api/canvas {action:"grade", courseId, assignmentId, userId, grade, comment?}
//   DELETE /studio/api/canvas                         -> forget a pasted token
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getViewer } from "@/lib/auth/server";
import { CanvasError, canvasToQuiz } from "@/lib/canvas/client";
import { canvasFor, connectCanvas, disconnectCanvas } from "@/lib/canvas/session";
import { qtiError, runQti } from "../../_lib/qti";
import { autoScan } from "../../_lib/autoscan";

async function professor() {
  const v = await getViewer().catch(() => null);
  return v && v.role === "professor" ? v : null;
}
const fail = (e: unknown) => Response.json({ error: (e as Error).message }, { status: e instanceof CanvasError && e.status ? e.status : 502 });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "canvas-quiz";

export async function GET() {
  const v = await professor();
  if (!v) return Response.json({ error: "Professors only." }, { status: 403 });
  const c = canvasFor(v.userId);
  return Response.json(c ? { connected: true, source: c.source, baseUrl: c.baseUrl } : { connected: false });
}

export async function DELETE() {
  const v = await professor();
  if (!v) return Response.json({ error: "Professors only." }, { status: 403 });
  disconnectCanvas(v.userId);
  return Response.json({ connected: false });
}

export async function POST(req: Request) {
  const v = await professor();
  if (!v) return Response.json({ error: "Professors only." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (b.action === "connect") {
      if (typeof b.baseUrl !== "string" || typeof b.token !== "string" || !b.token.trim()) return Response.json({ error: "Canvas URL and token are required." }, { status: 400 });
      return Response.json({ connected: true, ...(await connectCanvas(v.userId, b.baseUrl, b.token.trim())) });
    }
    const c = canvasFor(v.userId);
    if (!c) return Response.json({ error: "Canvas isn't connected." }, { status: 409 });
    const num = (x: unknown) => (Number.isInteger(Number(x)) && Number(x) > 0 ? Number(x) : null);
    if (b.action === "courses") return Response.json(await c.client.listCourses());
    if (b.action === "quizzes") {
      const courseId = num(b.courseId);
      if (!courseId) return Response.json({ error: "courseId is required" }, { status: 400 });
      return Response.json(await c.client.listQuizzes(courseId));
    }
    if (b.action === "import") {
      const courseId = num(b.courseId);
      const quizId = num(b.quizId);
      if (!courseId || !quizId) return Response.json({ error: "courseId and quizId are required" }, { status: 400 });
      const [quiz, questions] = await Promise.all([c.client.getQuiz(courseId, quizId), c.client.listQuestions(courseId, quizId)]);
      const imp = canvasToQuiz(questions, { quizId: slug(quiz.title), courseId: `canvas-${courseId}`, title: quiz.title, canvasCourseId: courseId, canvasQuizId: quizId, assignmentId: quiz.assignment_id });
      const tmp = path.join(os.tmpdir(), `unprompted-canvas-${Date.now()}.json`);
      await fs.writeFile(tmp, JSON.stringify(imp.quiz));
      try {
        const r = await runQti(["save", tmp]);
        if (r.code !== 0 || !r.json) return Response.json({ error: `Saving failed: ${qtiError(r.out)}` }, { status: 500 });
        const saved = r.json as { quizId?: string };
        if (saved.quizId) autoScan(saved.quizId, "Canvas import");
        return Response.json({ ...(r.json as object), skipped: imp.skipped, canvas: imp.canvas });
      } finally {
        await fs.rm(tmp, { force: true });
      }
    }
    if (b.action === "grade") {
      const courseId = num(b.courseId);
      const assignmentId = num(b.assignmentId);
      const userId = num(b.userId);
      if (!courseId || !assignmentId || !userId || typeof b.grade !== "string") return Response.json({ error: "courseId, assignmentId, userId and grade are required" }, { status: 400 });
      return Response.json(await c.client.pushGrade(courseId, assignmentId, userId, b.grade, typeof b.comment === "string" ? b.comment : undefined));
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
