import type { BranchStore } from "./types.js";

/**
 * "Merge" an experiment from its branch into main.
 * Neon has no native merge, so we upsert rows into main and keep the branch.
 *
 * - The variant_experiment row is always upserted, so main keeps a record of
 *   rejected candidates and why they failed (the studio shows these).
 * - The candidate item (variant_experiment.candidate_item_id) is copied only
 *   when `withItem` is true, i.e. for verified survivors. Rejected candidates
 *   never become items on main.
 */
export async function mergeVariant(
  store: BranchStore,
  branchName: string,
  variantId: string,
  opts: { withItem?: boolean } = {},
): Promise<void> {
  const withItem = opts.withItem ?? true;
  const exp = await store.branch(branchName);
  const main = await store.main();

  const { rows: variants } = await exp.db.query<Record<string, unknown>>(
    "select * from variant_experiment where id = $1",
    [variantId],
  );
  const v = variants[0];
  if (!v) throw new Error(`variant ${variantId} not found on ${branchName}`);

  let candidateItemId = (v.candidate_item_id as string | null) ?? null;
  if (withItem) {
    // Older rows (and the kill test) may not set candidate_item_id: fall back to
    // the single item on the branch derived from the source item.
    const { rows: items } = candidateItemId
      ? await exp.db.query<Record<string, unknown>>("select * from item where id = $1", [candidateItemId])
      : await exp.db.query<Record<string, unknown>>(
          `select b.* from item b where b.original_item_id = $1`,
          [v.item_id],
        );
    if (items.length !== 1) {
      throw new Error(`expected exactly one candidate item for ${variantId} on ${branchName}, found ${items.length}`);
    }
    const it = items[0]!;
    candidateItemId = it.id as string;
    await main.db.query(
      `insert into item (id, quiz_id, stem, type, choices_json, answer_key, objective, original_item_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do update set stem = excluded.stem, type = excluded.type, choices_json = excluded.choices_json,
         answer_key = excluded.answer_key, objective = excluded.objective, original_item_id = excluded.original_item_id`,
      [it.id, it.quiz_id, it.stem, it.type, json(it.choices_json), json(it.answer_key), it.objective, it.original_item_id],
    );
  }

  await main.db.query(
    `insert into variant_experiment
       (id, item_id, neon_branch, generator, strategy, candidate_json, status, reasons_json, checks_json, candidate_item_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (id) do update set status = excluded.status, reasons_json = excluded.reasons_json,
       candidate_json = excluded.candidate_json, neon_branch = excluded.neon_branch,
       checks_json = excluded.checks_json, candidate_item_id = excluded.candidate_item_id`,
    [
      v.id,
      v.item_id,
      branchName,
      v.generator,
      v.strategy,
      json(v.candidate_json),
      v.status,
      json(v.reasons_json),
      json(v.checks_json ?? {}),
      withItem ? candidateItemId : null,
    ],
  );
}

// jsonb columns come back parsed; send them back as JSON text.
function json(x: unknown) {
  return x == null ? null : JSON.stringify(x);
}
