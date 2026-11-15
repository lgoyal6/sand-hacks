import { afterAll, describe, expect, it } from "vitest";
import { loadSchema, mergeVariant, PGliteBranchStore } from "../src/db/index.js";

describe("PGlite branch store (Neon fallback)", async () => {
  const store = await PGliteBranchStore.create(await loadSchema());
  afterAll(() => store.close());

  it("branches are isolated copies of main, and merge upserts survivors into main", async () => {
    const main = await store.main();
    await main.db.query("insert into course (id, title) values ('c1', 'Stats')");
    await main.db.query("insert into quiz (id, course_id, title, source_format) values ('q1','c1','Quiz 1','markdown')");
    await main.db.query("insert into item (id, quiz_id, stem, type, objective) values ('i1','q1','orig','mcq','se')");

    const exp = await store.createBranch("exp/i1/1");
    await exp.db.query(
      "insert into item (id, quiz_id, stem, type, objective, original_item_id) values ('i1v1','q1','variant','mcq','se','i1')",
    );
    await exp.db.query(
      `insert into variant_experiment (id, item_id, neon_branch, generator, strategy, candidate_json, status, reasons_json)
       values ('v1','i1','exp/i1/1','gemini','isomorphic','{"stem":"variant"}','verified','[]')`,
    );

    // Main must not see branch writes before merge.
    expect((await main.db.query("select id from item where id = 'i1v1'")).rows).toHaveLength(0);

    await mergeVariant(store, "exp/i1/1", "v1");

    expect((await main.db.query("select stem from item where id = 'i1v1'")).rows).toEqual([{ stem: "variant" }]);
    const { rows } = await main.db.query<{ status: string; candidate_json: unknown }>(
      "select status, candidate_json from variant_experiment where id = 'v1'",
    );
    expect(rows[0]).toEqual({ status: "verified", candidate_json: { stem: "variant" } });
    expect(await store.listBranches()).toContain("exp/i1/1");
  }, 30_000);
});
