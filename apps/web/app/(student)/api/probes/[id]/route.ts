import { NextResponse } from "next/server";
import { getProbe, patchProbe, saveExplainSignals } from "../../../_lib/probes";
import { getAttempt } from "../../../quiz/_lib/attempts";
import { gradeProbeAsync } from "@/lib/agents/council";
import { writeEvents } from "@/lib/telemetry/server";

// Completes a probe: transcript, confidence after, counterfactual latency. Grading (the council) happens later.
export async function PATCH(req: Request, ctx: RouteContext<"/api/probes/[id]">) {
  const { id } = await ctx.params;
  const probe = await getProbe(id);
  if (!probe) return NextResponse.json({ error: "probe not found" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as {
    transcript?: string;
    explanation?: string;
    counterfactualAnswer?: string;
    confidenceAfter?: number;
    counterfactualLatencyMs?: number;
    retried?: boolean;
    conversationId?: string;
    reset?: boolean;
    mode?: "voice" | "typed";
    explainSignals?: Record<string, unknown>;
  };
  if (b.reset) {
    // One retry: clear the answer parts, keep the question and the first confidence rating.
    const out = await patchProbe(id, { retried: true, transcript: undefined, explanation: undefined, counterfactualAnswer: undefined, counterfactualPrompt: undefined, counterfactualLatencyMs: undefined, completedAt: undefined });
    return NextResponse.json({ ok: Boolean(out) });
  }
  // Voice required: a voice probe's words come from the call (/voice/finish), never as typed text here.
  if ((typeof b.explanation === "string" || typeof b.counterfactualAnswer === "string" || typeof b.transcript === "string") && probe.mode === "voice" && b.mode !== "typed") {
    const att = await getAttempt(probe.attemptId);
    if ((att?.probePlan ?? []).includes("voice:required") && !(att?.probePlan ?? []).includes(`acc:${probe.itemId}`))
      return NextResponse.json({ error: "This quiz asks you to explain out loud. Need another way? Request an accommodation." }, { status: 403 });
  }
  const patch: Record<string, unknown> = {};
  if (typeof b.transcript === "string") patch.transcript = b.transcript.slice(0, 20000);
  if (typeof b.explanation === "string") patch.explanation = b.explanation.slice(0, 4000);
  if (typeof b.counterfactualAnswer === "string") patch.counterfactualAnswer = b.counterfactualAnswer.slice(0, 4000);
  if (typeof b.conversationId === "string") patch.conversationId = b.conversationId.slice(0, 128);
  // A Scribe-measured latency (set when the voice call is finalized) beats the browser's VAD estimate.
  if (Number.isFinite(b.counterfactualLatencyMs) && probe.counterfactualLatencySource !== "scribe") {
    patch.counterfactualLatencyMs = Math.max(0, Math.round(b.counterfactualLatencyMs!));
    patch.counterfactualLatencySource = probe.mode === "voice" ? "vad" : "typed";
  }
  if (b.confidenceAfter !== undefined) {
    const c = Number(b.confidenceAfter);
    if (!Number.isInteger(c) || c < 1 || c > 7) return NextResponse.json({ error: "confidenceAfter must be 1..7" }, { status: 400 });
    patch.confidenceAfter = c;
    patch.completedAt = new Date().toISOString();
  }
  // A voice probe that switched to typing becomes typed (an accommodation stays an accommodation).
  if ((b.mode === "typed" || b.mode === "voice") && probe.mode !== "accommodation") {
    // Voice required: switching to typing needs the recorded accommodation; with it, the probe becomes one.
    const attempt = b.mode === "typed" ? await getAttempt(probe.attemptId) : null;
    const plan = attempt?.probePlan ?? [];
    if (plan.includes("voice:required"))
      if (!plan.includes(`acc:${probe.itemId}`))
        return NextResponse.json({ error: "This quiz asks you to explain out loud. Need another way? Request an accommodation." }, { status: 403 });
      else patch.mode = "accommodation";
    else patch.mode = b.mode;
  }
  if (b.explainSignals && typeof b.explainSignals === "object") {
    await saveExplainSignals(id, b.explainSignals);
    await writeEvents(
      Object.entries(b.explainSignals).map(([field, sig]) => ({
        ts: new Date().toISOString(),
        attemptId: probe.attemptId,
        itemId: probe.itemId,
        kind: "answer" as const,
        payload: { type: "probe_text", probeId: id, field, mode: (patch.mode as string) ?? probe.mode, ...(sig as object) },
      })),
    ).catch(() => {});
  }
  const out = await patchProbe(id, patch);
  // Grading council (B): once the probe is complete AND has words to grade. A voice probe whose transcript
  // hasn't arrived yet is graded by /voice/finish instead, so each probe is graded once.
  if (patch.completedAt && out && (out.explanation?.trim() || out.transcript?.trim() || out.counterfactualAnswer?.trim())) gradeProbeAsync(id);
  return NextResponse.json({ ok: true, probe: { id: out!.id, completedAt: out!.completedAt } });
}

// Student-facing result after the think-aloud: confidence before/after and, once the council has graded it,
// the explanation score (0-4, preliminary until a professor approves) with one line of feedback.
export async function GET(_req: Request, ctx: RouteContext<"/api/probes/[id]">) {
  const { id } = await ctx.params;
  const probe = await getProbe(id);
  if (!probe) return NextResponse.json({ error: "probe not found" }, { status: 404 });
  const council = probe.councilScores as unknown as { judges?: { round2?: { score: number; reason?: string }; round1?: { score: number; reason?: string } }[] } | undefined;
  const judges = Array.isArray(council?.judges) ? council!.judges : [];
  const final = typeof probe.finalScore === "number" ? probe.finalScore : null;
  // The reason from the judge whose score matches the median (final) score, when there is one.
  const match = judges.map((j) => j.round2 ?? j.round1).find((r) => r && r.score === final);
  return NextResponse.json({
    graded: final !== null,
    finalScore: final,
    preliminary: !probe.professorApproved,
    feedback: match?.reason ? match.reason.slice(0, 280) : null,
    confidenceBefore: probe.confidenceBefore,
    confidenceAfter: probe.confidenceAfter ?? null,
  });
}
