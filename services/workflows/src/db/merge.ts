import type { BranchStore } from "./types.js";

/**
 * "Merge" a verified variant from its experiment branch into main.
 * Neon has no native merge, so we upsert the variant_experiment row (and the
 * candidate item it produced, if present) into main. The branch is kept.
 */
export async function mergeVariant(store: BranchStore, branchName: string, variantId: string): Promise<void> {
  const exp = await store.branch(branchName);
  const main = await store.main();

  const { rows: variants } = await exp.db.query<Record<string, unknown>>(
    "select * from variant_experiment where id = $1",
    [variantId],
  );
  const v = variants[0];
  if (!v) throw new Error(`variant ${variantId} not found on ${branchName}`);

  // Items created on the branch for this variant (original_item_id = the item being transformed).
  const { rows: items } = await exp.db.query<Record<string, unknown>>(
    "select * from item where original_item_id = $1",
    [v.item_id],
  );

  for (const it of items) {
    await main.db.query(
      `insert into item (id, quiz_id, stem, type, choices_json, answer_key, objective, original_item_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do update set stem = excluded.stem, type = excluded.type, choices_json = excluded.choices_json,
         answer_key = excluded.answer_key, objective = excluded.objective, original_item_id = excluded.original_item_id`,
      [it.id, it.quiz_id, it.stem, it.type, json(it.choices_json), json(it.answer_key), it.objective, it.original_item_id],
    );
  }

  await main.db.query(
    `insert into variant_experiment (id, item_id, neon_branch, generator, strategy, candidate_json, status, reasons_json)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (id) do update set status = excluded.status, reasons_json = excluded.reasons_json,
       candidate_json = excluded.candidate_json, neon_branch = excluded.neon_branch`,
    [v.id, v.item_id, branchName, v.generator, v.strategy, json(v.candidate_json), v.status, json(v.reasons_json)],
  );
}

// jsonb columns come back parsed; send them back as JSON text.
function json(x: unknown) {
  return x == null ? null : JSON.stringify(x);
}
