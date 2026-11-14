import { NextResponse } from "next/server";
import { getProbe, patchProbe } from "../../../_lib/probes";

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
  };
  if (b.reset) {
    // One retry: clear the answer parts, keep the question and the first confidence rating.
    const out = await patchProbe(id, { retried: true, transcript: undefined, explanation: undefined, counterfactualAnswer: undefined, counterfactualPrompt: undefined, counterfactualLatencyMs: undefined, completedAt: undefined });
    return NextResponse.json({ ok: Boolean(out) });
  }
  const patch: Record<string, unknown> = {};
  if (typeof b.transcript === "string") patch.transcript = b.transcript.slice(0, 20000);
  if (typeof b.explanation === "string") patch.explanation = b.explanation.slice(0, 4000);
  if (typeof b.counterfactualAnswer === "string") patch.counterfactualAnswer = b.counterfactualAnswer.slice(0, 4000);
  if (typeof b.conversationId === "string") patch.conversationId = b.conversationId.slice(0, 128);
  if (Number.isFinite(b.counterfactualLatencyMs)) patch.counterfactualLatencyMs = Math.max(0, Math.round(b.counterfactualLatencyMs!));
  if (b.confidenceAfter !== undefined) {
    const c = Number(b.confidenceAfter);
    if (!Number.isInteger(c) || c < 1 || c > 7) return NextResponse.json({ error: "confidenceAfter must be 1..7" }, { status: 400 });
    patch.confidenceAfter = c;
    patch.completedAt = new Date().toISOString();
  }
  const out = await patchProbe(id, patch);
  return NextResponse.json({ ok: true, probe: { id: out!.id, completedAt: out!.completedAt } });
}
