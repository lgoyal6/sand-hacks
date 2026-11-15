import { NextResponse } from "next/server";
import { getAttempt, updateAttempt } from "../../../../quiz/_lib/attempts";
import { getQuiz } from "../../../../quiz/_lib/quizzes";
import { getProbe, patchProbe } from "../../../../_lib/probes";
import { signedUrl, voiceConfigured } from "../../../../_lib/elevenlabs";

// Starts a voice probe: records consent, returns a signed URL and the agent's dynamic variables.
export async function POST(req: Request, ctx: RouteContext<"/api/probes/[id]/voice">) {
  const { id } = await ctx.params;
  if (!voiceConfigured()) return NextResponse.json({ error: "voice is not set up" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { consent?: boolean };
  if (body.consent !== true) return NextResponse.json({ error: "recording needs explicit consent" }, { status: 400 });
  const probe = await getProbe(id);
  if (!probe) return NextResponse.json({ error: "probe not found" }, { status: 404 });
  const [attempt, quiz] = await Promise.all([getAttempt(probe.attemptId), getQuiz(probe.quizId)]);
  const item = quiz?.items.find((i) => i.id === probe.itemId);
  if (!attempt || !item) return NextResponse.json({ error: "item not found" }, { status: 404 });
  const answer = attempt.responses.find((r) => r.itemId === item.id)?.answer;
  const ids = Array.isArray(answer) ? answer : answer !== undefined ? [answer] : [];
  const studentAnswer = item.choices ? ids.map((a) => `${a}) ${item.choices!.find((c) => c.id === a)?.text ?? ""}`).join("; ") : String(answer ?? "");
  try {
    const url = await signedUrl();
    await Promise.all([patchProbe(id, { mode: "voice" }), updateAttempt(attempt.id, { consentAudio: true })]);
    return NextResponse.json({ signedUrl: url, dynamicVariables: { item_stem: item.stem, student_answer: studentAnswer || "(no answer)" } });
  } catch (err) {
    console.error("[voice] signed url failed:", (err as Error).message);
    return NextResponse.json({ error: "Voice is unavailable right now. Typing works just as well." }, { status: 502 });
  }
}
