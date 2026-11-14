import { NextResponse } from "next/server";
import { createAttempt, type AttemptMode } from "../../quiz/_lib/attempts";
import { getQuiz } from "../../quiz/_lib/quizzes";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { quizId?: string; mode?: AttemptMode; studentPseudonym?: string; consentAudio?: boolean };
  const quiz = body.quizId ? await getQuiz(body.quizId) : null;
  if (!quiz) return NextResponse.json({ error: "quiz not found" }, { status: 404 });
  const mode: AttemptMode = body.mode === "graded" ? "graded" : "practice";
  const attempt = await createAttempt({
    quizId: quiz.id,
    mode,
    studentPseudonym: body.studentPseudonym,
    consentAudio: body.consentAudio,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return NextResponse.json({ attemptId: attempt.id, mode: attempt.mode, studentPseudonym: attempt.studentPseudonym });
}
