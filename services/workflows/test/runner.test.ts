import { readFile } from "node:fs/promises";
import type { Item, Quiz, SolveRate } from "@unprompted/shared";
import { describe, expect, it } from "vitest";
import { loadSchema, PGliteBranchStore } from "../src/db/index.js";
import { parseMarkdownQuiz, saveQuiz } from "../src/ingest/markdown.js";
import { runTransform } from "../src/runner.js";
import { createTransformWorkflow } from "../src/mastra/index.js";
import { decide, loadExperiments, type Attacker, type Generator, type Judge, type Solver, type TransformEvent } from "../src/steps/index.js";
import { sameAnswer, extractFinal } from "../src/steps/answers.js";

const md = await readFile(new URL("../../../data/quizzes/sample-stats.md", import.meta.url), "utf8");

// Fakes. Each strategy is wired to one outcome so every branch of the runner is exercised.
//   isomorphic     -> passes everything, agents fail it      -> verified
//   application    -> solver disagrees with the key          -> rejected (answer key)
//   find_error     -> panel says objective changed           -> rejected (objective)
//   counterfactual -> passes checks, agents still solve it   -> rejected (solve rate)
const generator: Generator = {
  async generate(source: Item, strategy, k) {
    return {
      generator: "fake-gen",
      rationale: `fake ${strategy}`,
      candidate: {
        stem: `[${strategy}] ${source.stem} (v${k})`,
        type: "mcq",
        choices: [{ id: "a", text: "1" }, { id: "b", text: "2" }, { id: "c", text: "3" }, { id: "d", text: "4" }],
        answerKey: "c",
        objective: source.objective,
        originalItemId: source.id,
      },
    };
  },
};
const solver: Solver = {
  async solve(c) {
    return { answer: c.stem.startsWith("[application]") ? "a" : "c", usedCode: true, model: "fake-solver" };
  },
};
const judge = (name: string): Judge => ({
  name,
  async vote(_s, c) {
    const bad = c.stem.startsWith("[find_error]");
    return { judge: name, objectivePreserved: !bad, unambiguous: true, reason: bad ? "tests a different concept" : "ok" };
  },
});
let attackedQuiz: Quiz | null = null;
const attacker: Attacker = {
  async attack(quiz, itemIds) {
    attackedQuiz = quiz;
    const solveRates: SolveRate[] = itemIds.map((id) => {
      const stem = quiz.items.find((i) => i.id === id)!.stem;
      const correct = stem.startsWith("[counterfactual]") ? 8 : 1;
      return { itemId: id, runs: 9, correct, solveRate: correct / 9, agentSolvable: correct / 9 >= 0.6 };
    });
    return { solveRates };
  },
};

describe("transform runner (fake models, PGlite branches)", () => {
  it("keeps only candidates that pass every check, merges survivors and records rejections on main", async () => {
    const store = await PGliteBranchStore.create(await loadSchema());
    const quiz = parseMarkdownQuiz(md, { quizId: "sample-stats", courseId: "c1" });
    const main = await store.main();
    await saveQuiz(main.db, quiz);
    const events: TransformEvent[] = [];

    const res = await runTransform(
      store,
      quiz,
      [{ item: quiz.items[0]!, solveRate: 1 }],
      { generator, solver, judges: [judge("j1"), judge("j2"), judge("j3")], attacker },
      { candidatesPerItem: 4, strategies: ["isomorphic", "application", "find_error", "counterfactual"], onEvent: (e) => events.push(e) },
    );

    const byStrategy = Object.fromEntries(res.experiments.map((e) => [e.strategy, e]));
    expect(byStrategy.isomorphic!.status).toBe("verified");
    expect(byStrategy.isomorphic!.checks).toEqual({ answerKeyConsistent: true, objectivePreserved: true, unambiguous: true, newSolveRate: 1 / 9 });
    expect(byStrategy.application!.status).toBe("rejected");
    expect(byStrategy.application!.reasons[0]).toMatch(/answer key "c" not reproduced: solver gave a, a, a/);
    expect(byStrategy.find_error!.reasons[0]).toMatch(/changed the learning objective/);
    expect(byStrategy.counterfactual!.reasons[0]).toMatch(/agents still solve it: 8\/9/);

    // Only the two candidates that passed the cheap checks were re-attacked, in one batch.
    expect(attackedQuiz!.items.map((i) => i.originalItemId)).toEqual(["sample-stats-q1", "sample-stats-q1"]);

    // Main has the survivor's item and every experiment row with its reasons; rejected items never reach main.
    const ids = (await main.db.query<{ id: string }>("select id from item where original_item_id = 'sample-stats-q1'")).rows.map((r) => r.id);
    expect(ids).toEqual([byStrategy.isomorphic!.id]);
    const onMain = await loadExperiments(main.db, "sample-stats");
    expect(onMain).toHaveLength(4);
    expect(onMain.find((e) => e.strategy === "find_error")!.reasons[0]).toMatch(/objective/);

    // Branches are named exp/<item>/<k>, ids are <itemId>-v<k>, and kept on PGlite.
    expect(res.experiments.map((e) => e.id).sort()).toEqual(["sample-stats-q1-v1", "sample-stats-q1-v2", "sample-stats-q1-v3", "sample-stats-q1-v4"]);
    expect(await store.listBranches()).toContain("exp/sample-stats-q1/1");

    expect(events.filter((e) => e.type === "verified")).toHaveLength(1);
    expect(events.filter((e) => e.type === "rejected")).toHaveLength(3);
    expect(res.probePriority).toEqual([]);

    // A re-run numbers new variants after the old ones instead of colliding.
    const again = await runTransform(store, quiz, [{ item: quiz.items[0]!, solveRate: 1 }], { generator, solver, judges: [judge("j1"), judge("j2"), judge("j3")], attacker }, { candidatesPerItem: 1, strategies: ["application"] });
    expect(again.experiments[0]!.id).toBe("sample-stats-q1-v5");
    expect(again.probePriority).toEqual(["sample-stats-q1"]);
    await store.close();
  }, 60_000);

  it("a check that fails to run (quota) leaves the candidate unverified, never rejected", async () => {
    const store = await PGliteBranchStore.create(await loadSchema());
    const quiz = parseMarkdownQuiz(md, { quizId: "sample-stats", courseId: "c1" });
    await saveQuiz((await store.main()).db, quiz);
    const quota: Judge = { name: "jq", vote: async () => Promise.reject(new Error("429 RESOURCE_EXHAUSTED")) };
    const flaky: Solver = { solve: async () => Promise.reject(new Error("429 RESOURCE_EXHAUSTED")) };
    const deps = { generator, solver, judges: [judge("j1"), judge("j2"), quota], attacker };
    const a = await runTransform(store, quiz, [{ item: quiz.items[0]! , solveRate: 1 }], deps, { candidatesPerItem: 1, strategies: ["isomorphic"] });
    expect(a.experiments[0]!.status).toBe("proposed");
    expect(a.experiments[0]!.reasons[0]).toMatch(/^not verified: panel incomplete \(1\/3 seats failed\)/);
    const b = await runTransform(store, quiz, [{ item: quiz.items[1]!, solveRate: 1 }], { ...deps, solver: flaky }, { candidatesPerItem: 1, strategies: ["isomorphic"] });
    expect(b.experiments[0]!.status).toBe("proposed");
    expect(b.experiments[0]!.reasons[0]).toMatch(/^not verified: solver did not finish 3\/3/);
    const onMain = await loadExperiments((await store.main()).db, "sample-stats");
    expect(onMain.every((e) => e.status === "proposed")).toBe(true);
    await store.close();
  }, 60_000);

  it("the Mastra wrapper runs the same steps and streams runner events", async () => {
    const store = await PGliteBranchStore.create(await loadSchema());
    const quiz = parseMarkdownQuiz(md, { quizId: "sample-stats", courseId: "c1" });
    await saveQuiz((await store.main()).db, quiz);
    const wf = createTransformWorkflow({
      store,
      deps: { generator, solver, judges: [judge("j1"), judge("j2"), judge("j3")], attacker },
      opts: { candidatesPerItem: 1, strategies: ["isomorphic"] },
    });
    const run = await wf.createRun();
    const stream = run.stream({
      inputData: { quizId: "sample-stats", itemIds: ["sample-stats-q2"], solveRates: null, leakedItemIds: [], assumeSolveRate: 0.9 },
    });
    const types: string[] = [];
    for await (const chunk of stream.fullStream) {
      const c = chunk as { type: string; payload?: { output?: { type?: string } } };
      if (c.type === "workflow-step-output" && c.payload?.output?.type) types.push(c.payload.output.type);
    }
    const res = await stream.result;
    expect(res.status).toBe("success");
    const out = (res as { result: { experiments: { status: string }[]; notes: string[] } }).result;
    expect(out.experiments.map((e) => e.status)).toEqual(["verified"]);
    expect(out.notes[0]).toMatch(/ASSUMED 0.9/);
    expect(types).toContain("verified");
    await store.close();
  }, 60_000);

  it("decide() applies both halves of the survival rule", () => {
    const r = (correct: number, runs = 10): SolveRate => ({ itemId: "x", runs, correct, solveRate: correct / runs, agentSolvable: false });
    expect(decide(1, r(3)).survives).toBe(true);
    expect(decide(1, r(4)).survives).toBe(false); // above 0.3
    expect(decide(0.6, r(3)).survives).toBe(false); // only a 0.3 drop
    expect(decide(0.7, r(3)).survives).toBe(true); // exactly a 0.4 drop
    expect(decide(1, undefined).survives).toBe(false);
  });

  it("compares answers by type", () => {
    expect(sameAnswer("numeric", "1/6", "0.16667")).toBe(true);
    expect(sameAnswer("numeric", "1/6", "0.2")).toBe(false);
    expect(sameAnswer("mcq", " B ", "b")).toBe(true);
    expect(sameAnswer("mcq", "(c)", "c")).toBe(true);
    expect(sameAnswer("multi", "b, a", "a,b")).toBe(true);
    expect(extractFinal("work...\nFINAL: 3/8\n")).toBe("3/8");
    expect(extractFinal("**FINAL:** b")).toBe("b");
  });
});
