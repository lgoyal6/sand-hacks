// Approve or un-approve a verified variant (owner: B). Only verified variants can be approved.
//   POST /studio/api/variants/<id>  { "action": "approve" | "unapprove" }
import path from "node:path";
import type { VariantExperiment } from "@unprompted/shared";
import { FIXTURES_DIR, readJson, updateJson } from "@/lib/db/fixtures";
import { neonMain } from "../../../_lib/data";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const approve = body.action === "approve";
  if (!approve && body.action !== "unapprove") return Response.json({ error: "action must be approve or unapprove" }, { status: 400 });
  const from = approve ? "verified" : "approved";
  const to = approve ? "approved" : "verified";

  const db = neonMain();
  if (db) {
    const r = await db.query("update variant_experiment set status = $1 where id = $2 and status = $3 returning id", [to, id, from]);
    if (r.rowCount === 1) return Response.json({ id, status: to, source: "neon" });
    const exists = await db.query<{ status: string }>("select status from variant_experiment where id = $1", [id]);
    if (exists.rows[0]) return Response.json({ error: `variant is ${exists.rows[0].status}; only ${from} variants can be ${body.action}d` }, { status: 409 });
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
        result = { error: `variant is ${v.status}; only ${from} variants can be ${body.action}d` };
        return v;
      }
      result = { status: to };
      return { ...v, status: to };
    }),
  );
  if (result.error) return Response.json({ error: result.error }, { status: result.error === "variant not found" ? 404 : 409 });
  return Response.json({ id, status: result.status, source: "fixtures" });
}
