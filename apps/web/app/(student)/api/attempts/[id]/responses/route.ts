import { NextResponse } from "next/server";
import { getAttempt, recordResponse } from "../../../../quiz/_lib/attempts";
import { getQuiz, grade } from "../../../../quiz/_lib/quizzes";

export async function POST(req: Request, ctx: RouteContext<"/api/attempts/[id]/responses">) {
  const { id } = await ctx.params;
  const attempt = await getAttempt(id);
  if (!attempt) return NextResponse.json({ error: "attempt not found" }, { status: 404 });
  if (attempt.finishedAt) return NextResponse.json({ error: "attempt already submitted" }, { status: 409 });
  const body = (await req.json().catch(() => ({}))) as { itemId?: string; answer?: string | string[]; seconds?: number };
  const quiz = await getQuiz(attempt.quizId);
  const item = quiz?.items.find((i) => i.id === body.itemId);
  if (!item || body.answer === undefined) return NextResponse.json({ error: "bad item or answer" }, { status: 400 });
  const correct = grade(item, body.answer);
  await recordResponse(id, { itemId: item.id, answer: body.answer, correct, seconds: Number(body.seconds) || 0 });
  // Practice mode gives feedback right away; graded mode waits for the end.
  return NextResponse.json(attempt.mode === "practice" ? { saved: true, correct } : { saved: true });
}
