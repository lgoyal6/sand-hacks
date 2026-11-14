import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { loadSchema, PGliteBranchStore } from "../src/db/index.js";
import { loadQuiz, parseMarkdownQuiz, saveQuiz } from "../src/ingest/markdown.js";

const SAMPLE = new URL("../../../data/quizzes/sample-stats.md", import.meta.url);

describe("markdown quiz ingest", async () => {
  const md = await readFile(SAMPLE, "utf8");
  const quiz = parseMarkdownQuiz(md, { quizId: "stats-q1", courseId: "stats-101" });
  const store = await PGliteBranchStore.create(await loadSchema());
  afterAll(() => store.close());

  it("parses every item of the sample quiz with its answer key and objective", () => {
    expect(quiz.title).toBe("Sample quiz: Intro Statistics (OpenStax-style, written by us)");
    expect(quiz.items.map((i) => [i.id, i.type, i.answerKey])).toEqual([
      ["stats-q1-i1", "mcq", "b"],
      ["stats-q1-i2", "mcq", "b"],
      ["stats-q1-i3", "numeric", "1/6"],
      ["stats-q1-i4", "mcq", "b"],
      ["stats-q1-i5", "mcq", "b"],
    ]);
    expect(quiz.items[0]!.choices).toHaveLength(4);
    expect(quiz.items[0]!.choices![1]).toEqual({ id: "b", text: "2" });
    expect(quiz.items.every((i) => i.objective.length > 0)).toBe(true);
  });

  it("rejects malformed items instead of guessing", () => {
    expect(() => parseMarkdownQuiz("1. [mcq] Q?\n - a) x\n objective: o", { quizId: "q", courseId: "c" })).toThrow(/no \(answer\)/);
    expect(() => parseMarkdownQuiz("1. [essay] Q?", { quizId: "q", courseId: "c" })).toThrow(/unknown item type/);
    expect(() => parseMarkdownQuiz("1. [numeric] Q?\n answer: 3", { quizId: "q", courseId: "c" })).toThrow(/no objective/);
  });

  it("round-trips through the database idempotently", async () => {
    const main = await store.main();
    await saveQuiz(main.db, quiz);
    await saveQuiz(main.db, quiz);
    expect(await loadQuiz(main.db, "stats-q1")).toEqual(quiz);
  });
});
