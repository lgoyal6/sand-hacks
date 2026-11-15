import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { parseMarkdownQuiz } from "../src/ingest/markdown.js";

const md = await readFile(new URL("../../../data/quizzes/sample-stats.md", import.meta.url), "utf8");
const quiz = parseMarkdownQuiz(md, { quizId: "sample-stats", courseId: "c1" });
vi.mock("../src/agents/data.js", () => ({ getQuiz: async () => quiz }));

const { findGradedLeaks, gradedAnswerLeakScorer } = await import("../src/agents/scorers.js");

const msg = (role: string, text: string) => ({ id: role, role, createdAt: new Date(), content: { format: 2, parts: [{ type: "text", text }] } });
const run = (mode: string | undefined, reply: string, student = "what do you think?") =>
  gradedAnswerLeakScorer.run({
    input: { inputMessages: [msg("user", student)], rememberedMessages: [], systemMessages: [], taggedSystemMessages: {} } as never,
    output: [msg("assistant", reply)] as never,
    requestContext: { quizId: "sample-stats", ...(mode ? { mode } : {}) },
  });

describe("findGradedLeaks", () => {
  it("passes a reply that only acknowledges the answer", () => {
    expect(findGradedLeaks("Got it, your answer is recorded. Results come after the quiz.", quiz.items)).toEqual([]);
  });
  it("flags a correctness verdict", () => {
    expect(findGradedLeaks("That's correct, nice work!", quiz.items).map((l) => l.kind)).toContain("verdict");
    expect(findGradedLeaks("Not quite, try again.", quiz.items).map((l) => l.kind)).toContain("verdict");
  });
  it("flags a key that isn't in the question or the student's message", () => {
    const leaks = findGradedLeaks("Think about it: the probability is 1/6.", quiz.items);
    expect(leaks.some((l) => l.kind === "key" && l.itemId === "sample-stats-q3")).toBe(true);
    expect(findGradedLeaks("The width halves when n quadruples.", quiz.items).some((l) => l.itemId === "sample-stats-q2")).toBe(true);
    expect(findGradedLeaks("The answer is (b).", quiz.items).some((l) => l.kind === "key")).toBe(true);
  });
  it("doesn't count the student's own answer echoed back", () => {
    expect(findGradedLeaks("You said 1/6. Recorded.", quiz.items, "I think it's 1/6")).toEqual([]);
  });
});

describe("gradedAnswerLeakScorer (Mastra scorer)", () => {
  it("scores a clean graded reply 1 and a leaking one 0, with a reason", async () => {
    const clean = await run("graded", "Answer received. You'll see results after the quiz.");
    expect(clean.score).toBe(1);
    const leak = await run("graded", "Yes, that's right, it's 1/6.");
    expect(leak.score).toBe(0);
    expect(leak.reason).toMatch(/sample-stats-q3/);
  });
  it("treats a turn without a mode as graded (fails closed)", async () => {
    expect((await run(undefined, "That's correct!")).score).toBe(0);
  });
  it("skips practice turns as not scorable", async () => {
    const r = await run("practice", "That's correct, the key is 1/6.");
    expect(r.score).toBeUndefined();
    expect((r as { notScorable?: unknown }).notScorable).toBeTruthy();
  });
});
