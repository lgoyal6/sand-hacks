import { NextResponse } from "next/server";
import { getAttempt, recordResponse, updateAttempt } from "../../../../quiz/_lib/attempts";
import { shouldProbe } from "../../../../_lib/policy";
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
  const idx = quiz!.items.findIndex((i) => i.id === item.id);
  const triggered = attempt.probesTriggered ?? [];
  const decision = await shouldProbe({
    attemptId: id,
    itemId: item.id,
    mode: attempt.mode,
    plan: attempt.probePlan ?? [],
    triggered,
    remainingItems: quiz!.items.length - 1 - idx,
  });
  if (decision.probe) await updateAttempt(id, { probesTriggered: [...triggered, item.id] });
  // Practice mode gives feedback right away (shown after any probe); graded mode waits for the end.
  // The reason and anomaly score stay server-side.
  return NextResponse.json({ saved: true, probe: decision.probe, ...(attempt.mode === "practice" ? { correct } : {}) });
}
