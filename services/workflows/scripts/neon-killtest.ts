// Phase 0 kill test #5: create a branch from code, write to it, merge from it.
// Runs against real Neon when NEON_API_KEY, NEON_PROJECT_ID and DATABASE_URL are set,
// otherwise against the in-memory PGlite fallback (and says so).
//
//   pnpm --filter @unprompted/workflows killtest:neon
//   KEEP_BRANCH=1 ...   keep the experiment branch for inspection in the Neon console
import { mergeVariant, openBranchStore } from "../src/db/index.js";

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const branchName = `exp/killtest/${stamp}`;
const ids = {
  course: `killtest-course-${stamp}`,
  quiz: `killtest-quiz-${stamp}`,
  item: `killtest-item-${stamp}`,
  variantItem: `killtest-item-${stamp}-v1`,
  variant: `killtest-variant-${stamp}`,
};

const t0 = Date.now();
const timings: Record<string, number> = {};
async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const s = Date.now();
  const out = await fn();
  timings[label] = Date.now() - s;
  console.log(`  ok  ${label} (${timings[label]} ms)`);
  return out;
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

const store = await openBranchStore();
console.log(`Kill test #5 on ${store.kind === "neon" ? "REAL NEON" : "PGlite fallback (no Neon keys)"}, branch ${branchName}`);

let created = false;
try {
  const main = await store.main();

  await step("seed source item on main", async () => {
    await main.db.query("insert into course (id, title) values ($1, 'Kill test')", [ids.course]);
    await main.db.query("insert into quiz (id, course_id, title, source_format) values ($1, $2, 'Kill test quiz', 'markdown')", [
      ids.quiz,
      ids.course,
    ]);
    await main.db.query(
      "insert into item (id, quiz_id, stem, type, objective) values ($1, $2, 'n=25, s=10. Standard error?', 'mcq', 'compute standard error')",
      [ids.item, ids.quiz],
    );
  });

  const exp = await step("create branch from main", async () => {
    const b = await store.createBranch(branchName);
    created = true;
    return b;
  });

  await step("branch sees main's data (copy-on-write)", async () => {
    const { rows } = await exp.db.query("select id from item where id = $1", [ids.item]);
    assert(rows.length === 1, "source item should be visible on the new branch");
  });

  await step("write candidate + experiment to branch", async () => {
    await exp.db.query(
      `insert into item (id, quiz_id, stem, type, objective, original_item_id)
       values ($1, $2, 'n=64, s=24. Standard error?', 'mcq', 'compute standard error', $3)`,
      [ids.variantItem, ids.quiz, ids.item],
    );
    await exp.db.query(
      `insert into variant_experiment (id, item_id, neon_branch, generator, strategy, candidate_json, status, reasons_json)
       values ($1, $2, $3, 'killtest', 'isomorphic', $4, 'verified', '[]')`,
      [ids.variant, ids.item, branchName, JSON.stringify({ stem: "n=64, s=24. Standard error?" })],
    );
  });

  await step("main is isolated from branch writes", async () => {
    const { rows } = await main.db.query("select id from item where id = $1", [ids.variantItem]);
    assert(rows.length === 0, "main must not see the candidate before merge");
  });

  await step("merge survivor into main", () => mergeVariant(store, branchName, ids.variant));

  await step("verify merged rows on main", async () => {
    const { rows: items } = await main.db.query<{ original_item_id: string }>(
      "select original_item_id from item where id = $1",
      [ids.variantItem],
    );
    assert(items[0]?.original_item_id === ids.item, "merged candidate item should point at its source item");
    const { rows: vs } = await main.db.query<{ status: string; neon_branch: string }>(
      "select status, neon_branch from variant_experiment where id = $1",
      [ids.variant],
    );
    assert(vs[0]?.status === "verified" && vs[0]?.neon_branch === branchName, "merged experiment row should be on main");
  });
} finally {
  // Clean up kill-test rows on main (children first) and, unless asked, the branch.
  try {
    const main = await store.main();
    await main.db.query("delete from variant_experiment where id = $1", [ids.variant]);
    await main.db.query("delete from item where id = $1", [ids.variantItem]);
    await main.db.query("delete from item where id = $1", [ids.item]);
    await main.db.query("delete from quiz where id = $1", [ids.quiz]);
    await main.db.query("delete from course where id = $1", [ids.course]);
    if (created && !process.env.KEEP_BRANCH) await step("delete branch", () => store.deleteBranch(branchName));
  } finally {
    await store.close();
  }
}

console.log(`PASS kill test #5 on ${store.kind} in ${Date.now() - t0} ms`);
