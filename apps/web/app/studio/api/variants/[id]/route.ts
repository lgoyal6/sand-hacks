// Approve or un-approve a verified variant (owner: B). Only verified variants can be approved.
//   POST /studio/api/variants/<id>  { "action": "approve" | "unapprove" }
import path from "node:path";
import type { VariantExperiment } from "@unprompted/shared";
import { FIXTURES_DIR, readJson, updateJson } from "@/lib/db/fixtures";
import { neonMain } from "../../../_lib/data";
import { mastraAvailable, resumeTransform } from "../../../_lib/mastra";

const PAST = { approve: "approved", reject: "rejected", unapprove: "unapproved" } as const;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; runId?: string; note?: string };
  const action = body.action;
  if (action !== "approve" && action !== "unapprove" && action !== "reject") {
    return Response.json({ error: "action must be approve, reject or unapprove" }, { status: 400 });
  }

  // A suspended Mastra run decides through the workflow (human in the loop), not a direct write.
  if (body.runId && action !== "unapprove" && (await mastraAvailable())) {
    try {
      const res = await resumeTransform(body.runId, [{ id, approve: action === "approve", note: body.note }]);
      const decided = res.result?.decided ?? [];
      return Response.json({ id, status: decided.includes(id) ? (action === "approve" ? "approved" : "rejected") : "unchanged", source: "mastra", workflowStatus: res.status });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 502 });
    }
  }

  const from = action === "unapprove" ? "approved" : "verified";
  const to = action === "approve" ? "approved" : action === "reject" ? "rejected" : "verified";

  const db = neonMain();
  if (db) {
    const r = await db.query(
      `update variant_experiment set status = $1,
         reasons_json = case when $1 = 'rejected' then coalesce(reasons_json, '[]'::jsonb) || to_jsonb('Rejected by professor'::text) else reasons_json end
       where id = $2 and status = $3 returning id`,
      [to, id, from],
    );
    if (r.rowCount === 1) return Response.json({ id, status: to, source: "neon" });
    const exists = await db.query<{ status: string }>("select status from variant_experiment where id = $1", [id]);
    if (exists.rows[0]) return Response.json({ error: `variant is ${exists.rows[0].status}; only ${from} variants can be ${PAST[action]}` }, { status: 409 });
  }

  // Fixture fallback (no Neon, or the variant only exists in variants.json). Never create the file.
  const file = path.join(FIXTURES_DIR, "variants.json");
  const existing = await readJson<VariantExperiment[] | null>(file, null);
  if (!existing?.some((v) => v.id === id)) return Response.json({ error: "variant not found" }, { status: 404 });
  let result: { status?: string; error?: string } = { error: "variant not found" };
  await updateJson<VariantExperiment[]>(file, [], (all) =>
    all.map((v) => {
      if (v.id !== id) return v;
      if (v.status !== from) {
        result = { error: `variant is ${v.status}; only ${from} variants can be ${PAST[action]}` };
        return v;
      }
      result = { status: to };
      return { ...v, status: to, reasons: to === "rejected" ? [...v.reasons, "Rejected by professor"] : v.reasons };
    }),
  );
  if (result.error) return Response.json({ error: result.error }, { status: result.error === "variant not found" ? 404 : 409 });
  return Response.json({ id, status: result.status, source: "fixtures" });
}
