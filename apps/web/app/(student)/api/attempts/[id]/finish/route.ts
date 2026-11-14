import { NextResponse } from "next/server";
import { getAttempt, updateAttempt } from "../../../../quiz/_lib/attempts";
import { getQuiz } from "../../../../quiz/_lib/quizzes";

export async function POST(_req: Request, ctx: RouteContext<"/api/attempts/[id]/finish">) {
  const { id } = await ctx.params;
  const attempt = await getAttempt(id);
  if (!attempt) return NextResponse.json({ error: "attempt not found" }, { status: 404 });
  const done = attempt.finishedAt ? attempt : await updateAttempt(id, { finishedAt: new Date().toISOString() });
  const quiz = await getQuiz(attempt.quizId);
  const results = (quiz?.items ?? []).map((item) => {
    const r = done!.responses.find((x) => x.itemId === item.id);
    return { itemId: item.id, answered: Boolean(r), correct: r?.correct ?? false };
  });
  return NextResponse.json({
    attemptId: id,
    score: results.filter((r) => r.correct).length,
    total: results.length,
    results,
  });
}
