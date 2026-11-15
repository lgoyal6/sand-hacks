import { NextResponse } from "next/server";
import { getAttempt } from "../../quiz/_lib/attempts";
import { getQuiz } from "../../quiz/_lib/quizzes";
import { createProbe, openingPrompt } from "../../_lib/probes";
import { voiceConfigured } from "../../_lib/elevenlabs";

export async function GET() {
  // Capabilities only, so the client knows whether to offer voice.
  return NextResponse.json({ voiceAvailable: voiceConfigured() });
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
  const answer = attempt.responses.find((r) => r.itemId === item.id)?.answer;
  const probe = await createProbe({ attemptId: attempt.id, itemId: item.id, quizId: attempt.quizId, confidenceBefore: c, mode: body.mode === "voice" ? "voice" : "typed" });
  return NextResponse.json({ probeId: probe.id, opening: openingPrompt(item, answer) });
}
