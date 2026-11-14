import { NextResponse } from "next/server";
import { createAttempt, type AttemptMode } from "../../quiz/_lib/attempts";
import { getQuiz } from "../../quiz/_lib/quizzes";
import { planProbes } from "../../_lib/policy";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { quizId?: string; mode?: AttemptMode; studentPseudonym?: string; consentAudio?: boolean };
  const quiz = body.quizId ? await getQuiz(body.quizId) : null;
  if (!quiz) return NextResponse.json({ error: "quiz not found" }, { status: 404 });
  const mode: AttemptMode = body.mode === "graded" ? "graded" : "practice";
  const { plan } = await planProbes(quiz.items.map((i) => i.id), mode);
  const attempt = await createAttempt({
    probePlan: plan,
    quizId: quiz.id,
    mode,
    studentPseudonym: body.studentPseudonym,
    consentAudio: body.consentAudio,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return NextResponse.json({ attemptId: attempt.id, mode: attempt.mode, studentPseudonym: attempt.studentPseudonym });
}
