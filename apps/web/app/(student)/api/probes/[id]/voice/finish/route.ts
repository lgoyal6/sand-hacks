import { NextResponse } from "next/server";
import { getProbe, patchProbe } from "../../../../../_lib/probes";
import { formatTranscript, getConversation } from "../../../../../_lib/elevenlabs";

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
    await patchProbe(id, {
      conversationId,
      transcript,
      explanation: explanation || probe.explanation,
      counterfactualAnswer: cfAnswer?.message?.trim() ?? probe.counterfactualAnswer,
    });
    return NextResponse.json({ status: conv.status, transcript, turns: turns.length, durationSecs: conv.metadata?.call_duration_secs ?? null });
  } catch (err) {
    console.error("[voice] finish failed:", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
