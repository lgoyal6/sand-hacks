import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/server";
import { quizVoiceRequired, setQuizVoiceRequired } from "../../../../quiz/_lib/quizzes";

// Professor quiz settings. GET is open (the runtime needs it); PATCH requires the professor role.
export async function GET(_req: Request, ctx: RouteContext<"/api/quizzes/[id]/settings">) {
  const { id } = await ctx.params;
  return NextResponse.json({ quizId: id, voiceRequired: await quizVoiceRequired(id) });
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/quizzes/[id]/settings">) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "professor") return NextResponse.json({ error: "professors only" }, { status: 403 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { voiceRequired?: boolean };
  if (typeof body.voiceRequired !== "boolean") return NextResponse.json({ error: "voiceRequired must be a boolean" }, { status: 400 });
  try {
    const ok = await setQuizVoiceRequired(id, body.voiceRequired);
    if (!ok) return NextResponse.json({ error: "quiz not found" }, { status: 404 });
    return NextResponse.json({ quizId: id, voiceRequired: body.voiceRequired });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 });
  }
}
