import { NextResponse } from "next/server";
import { getAttempt } from "../../quiz/_lib/attempts";
import { getQuiz } from "../../quiz/_lib/quizzes";
import { createProbe, openingPrompt } from "../../_lib/probes";
import { voiceConfigured } from "../../_lib/elevenlabs";

export async function GET(req: Request) {
  // Capabilities, so the client knows whether to offer voice and whether this attempt requires it.
  const attemptId = new URL(req.url).searchParams.get("attempt");
  const attempt = attemptId ? await getAttempt(attemptId) : null;
  return NextResponse.json({ voiceAvailable: voiceConfigured(), voiceRequired: (attempt?.probePlan ?? []).includes("voice:required") });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { attemptId?: string; itemId?: string; confidenceBefore?: number; mode?: "voice" | "typed" };
  const attempt = body.attemptId ? await getAttempt(body.attemptId) : null;
  if (!attempt) return NextResponse.json({ error: "attempt not found" }, { status: 404 });
  // Only items the policy actually selected can be probed.
  if (!body.itemId || !(attempt.probesTriggered ?? []).includes(body.itemId)) return NextResponse.json({ error: "no probe for this item" }, { status: 400 });
  const c = Number(body.confidenceBefore);
  if (!Number.isInteger(c) || c < 1 || c > 7) return NextResponse.json({ error: "confidenceBefore must be 1..7" }, { status: 400 });
  const quiz = await getQuiz(attempt.quizId);
  const item = quiz?.items.find((i) => i.id === body.itemId);
  if (!item) return NextResponse.json({ error: "item not found" }, { status: 404 });
  // Voice required: typed explanations only through a recorded accommodation (never penalized).
  const plan = attempt.probePlan ?? [];
  if (plan.includes("voice:required") && body.mode !== "voice" && !plan.includes(`acc:${item.id}`))
    return NextResponse.json({ error: "This quiz asks you to explain out loud. Need another way? Request an accommodation." }, { status: 403 });
  const answer = attempt.responses.find((r) => r.itemId === item.id)?.answer;
  const probe = await createProbe({ attemptId: attempt.id, itemId: item.id, quizId: attempt.quizId, confidenceBefore: c, mode: (attempt.probePlan ?? []).includes(`acc:${item.id}`) ? "accommodation" : body.mode === "voice" ? "voice" : "typed" });
  return NextResponse.json({ probeId: probe.id, opening: openingPrompt(item, answer) });
}
