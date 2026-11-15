import { NextResponse } from "next/server";
import { getAttempt, recordResponse, updateAttempt } from "../../../../quiz/_lib/attempts";
import { shouldProbe } from "../../../../_lib/policy";
import { writeEvents } from "@/lib/telemetry/server";
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
  // Server-side record of every submission, so a submit with no client telemetry at all
  // (answers filled by script, or the API called directly) is still visible to D's features.
  await writeEvents([
    {
      ts: new Date().toISOString(),
      attemptId: id,
      itemId: item.id,
      kind: "answer",
      payload: { type: "server_submit", seconds: Number(body.seconds) || 0, userAgent: req.headers.get("user-agent")?.slice(0, 200) ?? null },
    },
  ]).catch((err) => console.error("[telemetry] server_submit write failed:", (err as Error).message));
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
  // In practice the student also learns the right answer (after any probe, client-side), so feedback can teach.
  const key = Array.isArray(item.answerKey) ? item.answerKey : [item.answerKey];
  return NextResponse.json({ saved: true, probe: decision.probe, ...(attempt.mode === "practice" ? { correct, correctAnswer: key } : {}) });
}
