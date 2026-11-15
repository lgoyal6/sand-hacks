import { NextResponse } from "next/server";
import { createAttempt, listAttempts, type AttemptMode } from "../../quiz/_lib/attempts";
import { getQuiz } from "../../quiz/_lib/quizzes";
import { planProbes } from "../../_lib/policy";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { quizId?: string; mode?: AttemptMode; studentPseudonym?: string; consentAudio?: boolean; itemIds?: string[] };
  if (body.studentPseudonym !== undefined && !/^[\w-]{1,64}$/.test(body.studentPseudonym)) body.studentPseudonym = undefined;
  const quiz = body.quizId ? await getQuiz(body.quizId) : null;
  if (!quiz) return NextResponse.json({ error: "quiz not found" }, { status: 404 });
  const mode: AttemptMode = body.mode === "graded" ? "graded" : "practice";
  // A focused session ("Practice this") plans probes over just its items.
  const focus = Array.isArray(body.itemIds) ? quiz.items.filter((i) => body.itemIds!.includes(i.id)).map((i) => i.id) : [];
  const { plan } = await planProbes(focus.length ? focus : quiz.items.map((i) => i.id), mode);
  const attempt = await createAttempt({
    probePlan: plan,
    quiz,
    mode,
    studentPseudonym: body.studentPseudonym,
    consentAudio: body.consentAudio,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return NextResponse.json({ attemptId: attempt.id, mode: attempt.mode, studentPseudonym: attempt.studentPseudonym });
}

// Runner-only results read for workstream A (grading agent runs server-side, without trusting the agent).
// Guarded by x-runner-token so a browser agent on the page can't read its own grades.
export async function GET(req: Request) {
  const expected = process.env.SANDBOX_RUNNER_TOKEN?.trim() || "dev-runner-token";
  if (req.headers.get("x-runner-token") !== expected) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const student = new URL(req.url).searchParams.get("student");
  if (!student || !/^[\w-]{1,64}$/.test(student)) return NextResponse.json({ error: "student required" }, { status: 400 });
  const attempts = await listAttempts({ student });
  return NextResponse.json({
    attempts: attempts.map((a) => ({
      attemptId: a.id,
      quizId: a.quizId,
      mode: a.mode,
      startedAt: a.startedAt,
      finishedAt: a.finishedAt ?? null,
      userAgent: a.userAgent ?? null,
      probesTriggered: a.probesTriggered ?? [],
      responses: a.responses.map((r) => ({ itemId: r.itemId, correct: r.correct, seconds: r.seconds, answeredAt: r.answeredAt })),
    })),
  });
}
