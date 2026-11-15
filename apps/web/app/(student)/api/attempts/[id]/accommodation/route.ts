import { NextResponse } from "next/server";
import { addAccommodation, getAttempt } from "../../../../quiz/_lib/attempts";
import { getQuiz, type FigureItem } from "../../../../quiz/_lib/quizzes";
import { writeEvents } from "@/lib/telemetry/server";
import { neon } from "@/lib/db/neon";

// figure_text lives server-side in Neon for merged figure variants (B); never sent to the browser otherwise.
async function figureTextFromNeon(itemId: string): Promise<string | null> {
  const db = neon();
  if (!db) return null;
  try {
    const { rows } = await db.query<{ figure_text: string | null }>("select figure_text from item where id = $1", [itemId]);
    return rows[0]?.figure_text?.trim() || null;
  } catch {
    return null;
  }
}

// POST /api/attempts/<id>/accommodation { itemId }: the student asked for the accessible (text) version of a
// figure item. Returns the figure's data as text, records the accommodation (the item's think-aloud then
// always runs, never penalized), and logs it so D can exclude that item from detection features.
export async function POST(req: Request, ctx: RouteContext<"/api/attempts/[id]/accommodation">) {
  const { id } = await ctx.params;
  const attempt = await getAttempt(id);
  if (!attempt) return NextResponse.json({ error: "attempt not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { itemId?: string; kind?: "figure_text" | "typed_explanation" };
  const quiz = await getQuiz(attempt.quizId);
  const item = quiz?.items.find((i) => i.id === body.itemId) as FigureItem | undefined;
  // Typed explanation instead of voice (voice-required quizzes): allowed for any item, recorded, never penalized.
  if (body.kind === "typed_explanation") {
    if (!item) return NextResponse.json({ error: "item not found" }, { status: 404 });
    await addAccommodation(id, item.id, "typed_explanation");
    await writeEvents([
      { ts: new Date().toISOString(), attemptId: id, itemId: item.id, kind: "focus", payload: { type: "accommodation", accommodation: "typed_explanation", excludeFromDetection: true } },
    ]).catch(() => {});
    return NextResponse.json({ ok: true });
  }
  if (!item?.figure) return NextResponse.json({ error: "this question has no figure" }, { status: 400 });
  const text = item.figureText?.trim() || (await figureTextFromNeon(item.id)) || item.figure.alt;
  await addAccommodation(id, item.id, "figure_text");
  await writeEvents([
    { ts: new Date().toISOString(), attemptId: id, itemId: item.id, kind: "focus", payload: { type: "accommodation", accommodation: "figure_text", excludeFromDetection: true } },
  ]).catch(() => {});
  return NextResponse.json({ figureText: text });
}
