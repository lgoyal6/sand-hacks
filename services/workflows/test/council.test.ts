import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkQuotes, loadCouncilInput, median, runCouncil, saveCouncil, type CouncilInput } from "../src/council/index.js";
import { loadSchema, PGliteBranchStore } from "../src/db/index.js";
import { parseMarkdownQuiz, saveQuiz } from "../src/ingest/markdown.js";
import type { JsonModel } from "../src/steps/llm.js";

const md = await readFile(new URL("../../../data/quizzes/sample-stats.md", import.meta.url), "utf8");

const input: CouncilInput = {
  probeId: "p1",
  objective: "interpret a p-value",
  stem: "A study finds p = 0.03 at alpha = 0.05. Which statement is correct?",
  key: "b",
  studentAnswer: "b",
  correct: true,
  explanation: "If the null were true, results this extreme would happen about 3% of the time.",
  counterfactualPrompt: "What if p were 0.08?",
  counterfactualAnswer: "Then we would fail to reject the null at 0.05.",
};

/** Fake judge: fixed round-1 score, then optionally moves to the others' median; records prompts. */
function judge(name: string, first: number, second: number, prompts: string[]): JsonModel {
  return {
    name,
    async json<T>(prompt: string, schema: z.ZodType<T>) {
      prompts.push(`${name}:${prompt}`);
      const r2 = prompt.includes("Reconsider once");
      return schema.parse({ score: r2 ? second : first, evidence: ["results this extreme would happen", "invented quote that the student never said"], reason: "ok" });
    },
  };
}

describe("grading council (three Gemini models, two rounds, median)", () => {
  it("runs two rounds, shows each judge the others' scores, keeps only real quotes, takes the median", async () => {
    const prompts: string[] = [];
    const r = await runCouncil(input, [judge("A", 4, 4, prompts), judge("B", 2, 3, prompts), judge("C", 3, 3, prompts)]);
    expect(r.panel).toBe("three Gemini models");
    expect(r.judges.map((j) => [j.round1.score, j.round2.score])).toEqual([[4, 4], [2, 3], [3, 3]]);
    expect(r.finalScore).toBe(3);
    expect(r.judges[0]!.round1.evidence).toEqual(["results this extreme would happen"]);
    expect(r.judges[0]!.round1.droppedQuotes).toBe(1);
    const bRound2 = prompts.find((p) => p.startsWith("B:") && p.includes("Reconsider once"))!;
    expect(bRound2).toContain("Your first score: 2/4");
    expect(bRound2).toContain("Another grader: 4/4");
    expect(bRound2).toContain("Another grader: 3/4");
    expect(r.rubric).toMatch(/Ignore grammar, spelling, fluency/);
  });

  it("median and quote checks", () => {
    expect(median([1, 4, 2])).toBe(2);
    expect(median([0, 4])).toBe(2);
    expect(checkQuotes(["About 3% of the time", "nope"], "it would happen ABOUT 3% of the time.")).toEqual({ kept: ["About 3% of the time"], dropped: 1 });
  });

  it("loads a probe from the database (student turns from the transcript) and saves the score without approving it", async () => {
    const store = await PGliteBranchStore.create(await loadSchema());
    const db = (await store.main()).db;
    const quiz = parseMarkdownQuiz(md, { quizId: "sample-stats", courseId: "c1" });
    await saveQuiz(db, quiz);
    await db.query("insert into attempt (id, student_pseudonym, quiz_id, mode) values ('a1', 'student-1', 'sample-stats', 'practice')");
    await db.query("insert into response (id, attempt_id, item_id, answer, correct) values ('r1', 'a1', 'sample-stats-q4', '\"b\"', true)");
    await db.query(
      `insert into probe (id, attempt_id, item_id, transcript, counterfactual_prompt, counterfactual_answer, completed_at)
       values ('p1', 'a1', 'sample-stats-q4', $1, 'What if p were 0.08?', 'We would not reject the null.', now())`,
      ["Unprompted: Walk me through it.\nStudent (typed): If the null were true, data this extreme would show up 3% of the time.\nUnprompted: Thanks."],
    );
    const loaded = await loadCouncilInput(db, "p1");
    expect(loaded).toMatchObject({ objective: "interpret a p-value", key: "b", studentAnswer: "b", correct: true, counterfactualAnswer: "We would not reject the null." });
    expect(loaded!.explanation).toBe("If the null were true, data this extreme would show up 3% of the time.");
    const prompts: string[] = [];
    const r = await runCouncil(loaded!, [judge("A", 3, 3, prompts), judge("B", 3, 3, prompts), judge("C", 2, 2, prompts)]);
    await saveCouncil(db, "p1", r);
    const row = (await db.query<{ final_score: number; professor_approved: boolean; council_scores_json: { panel: string } }>("select final_score, professor_approved, council_scores_json from probe where id = 'p1'")).rows[0]!;
    expect(row.final_score).toBe(3);
    expect(row.professor_approved).toBe(false);
    expect(row.council_scores_json.panel).toBe("three Gemini models");
    await store.close();
  }, 60_000);
});
