// Learning objective for one question (owner: B). Professor-only.
//   GET  /studio/api/objective?item=<itemId>          -> {itemId, objective, source: "inferred" | "professor" | null}
//   POST /studio/api/objective {itemId, objective}     -> the same, with source "professor"
// A Canvas import can only guess the objective (the question title or a stem excerpt). The rewriter and the judge
// panel hold the objective fixed, so the professor confirms it here before a rewrite; the workflow refuses
// to rewrite an item whose objective is still "inferred".
import { getViewer } from "@/lib/auth/server";
import { neon } from "@/lib/db/neon";

type Row = { id: string; objective: string | null; objective_source: string | null };
const view = (r: Row) => ({ itemId: r.id, objective: r.objective ?? "", source: r.objective_source === "inferred" || r.objective_source === "professor" ? r.objective_source : null });

async function guard() {
  const viewer = await getViewer().catch(() => null);
  if (!viewer || viewer.role !== "professor") return Response.json({ error: "Professors only." }, { status: 403 });
  if (!neon()) return Response.json({ error: "Saving a learning objective needs DATABASE_URL (Neon main)." }, { status: 503 });
  return null;
}

export async function GET(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const itemId = new URL(req.url).searchParams.get("item") ?? "";
  if (!/^[\w-]+$/.test(itemId)) return Response.json({ error: "Which question?" }, { status: 400 });
  try {
    const { rows } = await neon()!.query<Row>("select id, objective, objective_source from item where id = $1 and original_item_id is null", [itemId]);
    return rows[0] ? Response.json(view(rows[0])) : Response.json({ error: "Question not found." }, { status: 404 });
  } catch (e) {
    return Response.json({ error: `Couldn't read the objective: ${(e as Error).message}` }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const b = (await req.json().catch(() => ({}))) as { itemId?: string; objective?: string };
  const itemId = b.itemId ?? "";
  const objective = (b.objective ?? "").replace(/\s+/g, " ").trim();
  if (!/^[\w-]+$/.test(itemId)) return Response.json({ error: "Which question?" }, { status: 400 });
  if (objective.length < 3) return Response.json({ error: "Describe the skill this question checks." }, { status: 400 });
  if (objective.length > 200) return Response.json({ error: "Keep the objective under 200 characters." }, { status: 400 });
  try {
    const { rows } = await neon()!.query<Row>(
      "update item set objective = $2, objective_source = 'professor' where id = $1 and original_item_id is null returning id, objective, objective_source",
      [itemId, objective],
    );
    return rows[0] ? Response.json(view(rows[0])) : Response.json({ error: "Question not found." }, { status: 404 });
  } catch (e) {
    return Response.json({ error: `Couldn't save the objective: ${(e as Error).message}` }, { status: 502 });
  }
}
