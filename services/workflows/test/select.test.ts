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
});
