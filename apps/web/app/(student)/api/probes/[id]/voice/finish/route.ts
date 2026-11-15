import { NextResponse } from "next/server";
import { getProbe, patchProbe } from "../../../../../_lib/probes";
import { cfLatencyFromWords, formatTranscript, getConversation, scribeCall } from "../../../../../_lib/elevenlabs";

// After the call: pull the finalized transcript (with per-turn times) from ElevenLabs and store it.
export async function POST(req: Request, ctx: RouteContext<"/api/probes/[id]/voice/finish">) {
  const { id } = await ctx.params;
  const probe = await getProbe(id);
  if (!probe) return NextResponse.json({ error: "probe not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { conversationId?: string };
  const conversationId = body.conversationId ?? probe.conversationId;
  if (!conversationId || !/^[\w-]{4,128}$/.test(conversationId)) return NextResponse.json({ error: "conversationId required" }, { status: 400 });
  try {
    const conv = await getConversation(conversationId);
    const turns = conv.transcript ?? [];
    const transcript = formatTranscript(turns);
    const userTurns = turns.filter((t) => t.role === "user" && t.message?.trim());
    // Timing rows come only from the browser, stamped at the real moment (D's probe_latency view
    // uses wall-clock ts). The transcript's per-turn times are kept in the transcript text.
    const cfIdx = turns.findIndex((t) => t.role === "agent" && probe.counterfactualPrompt && t.message && t.message.includes(probe.counterfactualPrompt.slice(0, 25)));
    const cfAnswer = cfIdx >= 0 ? turns.slice(cfIdx + 1).find((t) => t.role === "user" && t.message?.trim()) : undefined;
    const explanation = userTurns
      .filter((t) => cfIdx < 0 || turns.indexOf(t) < cfIdx)
      .map((t) => t.message!.trim())
      .join(" ");
    // Precise counterfactual latency from Scribe word timestamps on the recording (VAD stays the live fallback).
    let scribe: { latencyMs: number; cfEndSec: number; answerStartSec: number } | null = null;
    let words: { t: string; s: number; e: number; spk?: string }[] | undefined;
    if (probe.counterfactualPrompt) {
      try {
        const w = await scribeCall(conversationId);
        if (w?.length) {
          scribe = cfLatencyFromWords(w, probe.counterfactualPrompt, cfIdx >= 0 ? turns[cfIdx].time_in_call_secs : undefined);
          words = w.map((x) => ({ t: x.text, s: Math.round(x.start * 100) / 100, e: Math.round(x.end * 100) / 100, spk: x.speaker_id }));
        }
      } catch (err) {
        console.warn("[voice] Scribe latency failed, keeping VAD:", (err as Error).message);
      }
    }
    await patchProbe(id, {
      conversationId,
      transcript,
      explanation: explanation || probe.explanation,
      counterfactualAnswer: cfAnswer?.message?.trim() ?? probe.counterfactualAnswer,
      ...(scribe ? { counterfactualLatencyMs: scribe.latencyMs, counterfactualLatencySource: "scribe" as const, scribeWords: words } : {}),
    });
    return NextResponse.json({
      status: conv.status,
      transcript,
      turns: turns.length,
      durationSecs: conv.metadata?.call_duration_secs ?? null,
      latency: scribe ? { source: "scribe", ...scribe } : null,
      words: words?.length ?? 0,
    });
  } catch (err) {
    console.error("[voice] finish failed:", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
