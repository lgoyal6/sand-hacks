import { NextResponse } from "next/server";
import { getAttempt } from "../../../../quiz/_lib/attempts";
import { getQuiz } from "../../../../quiz/_lib/quizzes";
import { counterfactualFor, getProbe, patchProbe } from "../../../../_lib/probes";

// Generates the counterfactual follow-up from the item, the student's answer and their explanation.
// Also the target of the ElevenLabs client tool, so the voice agent asks the same question.
export async function POST(req: Request, ctx: RouteContext<"/api/probes/[id]/counterfactual">) {
  const { id } = await ctx.params;
  const probe = await getProbe(id);
  if (!probe) return NextResponse.json({ error: "probe not found" }, { status: 404 });
  if (probe.counterfactualPrompt) return NextResponse.json({ prompt: probe.counterfactualPrompt, source: probe.counterfactualSource });
  const body = (await req.json().catch(() => ({}))) as { explanation?: string };
  const attempt = await getAttempt(probe.attemptId);
  const quiz = await getQuiz(probe.quizId);
  const item = quiz?.items.find((i) => i.id === probe.itemId);
  if (!attempt || !item) return NextResponse.json({ error: "item not found" }, { status: 404 });
  const answer = attempt.responses.find((r) => r.itemId === item.id)?.answer;
  const explanation = String(body.explanation ?? "").slice(0, 4000);
  const cf = await counterfactualFor(item, answer, explanation);
  await patchProbe(id, { counterfactualPrompt: cf.prompt, counterfactualSource: cf.source, explanation });
  return NextResponse.json({ prompt: cf.prompt, source: cf.source });
}
