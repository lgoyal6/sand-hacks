import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseMarkdownQuiz } from "../src/ingest/markdown.js";
import { selectTargets } from "../src/steps/index.js";

const md = await readFile(new URL("../../../data/quizzes/sample-stats.md", import.meta.url), "utf8");
const quiz = parseMarkdownQuiz(md, { quizId: "sample-stats", courseId: "c1" });

describe("selectTargets", () => {
  it("still refuses an item with no solve rate that wasn't found online", () => {
    expect(() => selectTargets(quiz, null, [], { itemIds: ["sample-stats-q2"], assumeSolveRate: null })).toThrow(/no solve rate/);
  });
  it("takes a leaked item without an agent baseline (fresh Canvas import) and says why", () => {
    const { targets, notes } = selectTargets(quiz, null, ["sample-stats-q2"], { itemIds: ["sample-stats-q2"], assumeSolveRate: null });
    expect(targets.map((t) => [t.item.id, t.leaked])).toEqual([["sample-stats-q2", true]]);
    expect(notes.join(" ")).toMatch(/found online/);
  });
  it("refuses to rewrite an imported item until the professor confirms its learning objective", () => {
    const guessed = { ...quiz, items: quiz.items.map((i) => (i.id === "sample-stats-q2" ? { ...i, objectiveSource: "inferred" as const } : i)) };
    expect(() => selectTargets(guessed, null, ["sample-stats-q2"], { itemIds: ["sample-stats-q2"] })).toThrow(/confirm the learning objective/);
    const auto = selectTargets(guessed, null, ["sample-stats-q2"]);
    expect(auto.targets).toEqual([]);
    expect(auto.notes.join(" ")).toMatch(/not confirmed/);
    const confirmed = { ...guessed, items: guessed.items.map((i) => (i.id === "sample-stats-q2" ? { ...i, objective: "Reading a p-value", objectiveSource: "professor" as const } : i)) };
    const ok = selectTargets(confirmed, null, ["sample-stats-q2"], { itemIds: ["sample-stats-q2"] });
    expect(ok.targets[0]!.item.objective).toBe("Reading a p-value");
  });
});
