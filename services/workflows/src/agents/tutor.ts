// Tutor: runs a quiz conversation with the student. In graded mode it can't reveal answers,
// because its tools never return keys or correctness then (enforced in code, not just the prompt).
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { sameAnswer, answerText } from "../steps/answers.js";
import { getQuiz, publicItem, session, store } from "./data.js";
import { AnswerBeforeLimit, FlattenToolHistory } from "./compat.js";
import { agentModels } from "./model.js";

export const startQuiz = createTool({
  id: "startQuiz",
  description: "Load the student's current quiz: title and questions (no answer keys). Call this before presenting questions.",
  inputSchema: z.object({}),
  outputSchema: z.object({ quizId: z.string(), title: z.string(), mode: z.enum(["practice", "graded"]), questions: z.array(z.any()) }),
  execute: async (_input, { requestContext }) => {
    const s = session(requestContext);
    if (!s.quizId) throw new Error("No quiz is attached to this session.");
    const quiz = await getQuiz(s.quizId);
    return { quizId: quiz.id, title: quiz.title, mode: s.mode, questions: quiz.items.map(publicItem) };
  },
});

export const checkAnswer = createTool({
  id: "checkAnswer",
  description:
    "Check the student's answer to one question. In practice mode returns whether it's correct and the key; in graded mode only confirms the answer was received.",
  inputSchema: z.object({ itemId: z.string(), answer: z.string().describe("choice id (e.g. b), comma-separated ids, or the value") }),
  outputSchema: z.object({ itemId: z.string(), received: z.boolean(), correct: z.boolean().optional(), key: z.string().optional(), note: z.string() }),
  execute: async ({ itemId, answer }, { requestContext }) => {
    const s = session(requestContext);
    if (!s.quizId) throw new Error("No quiz is attached to this session.");
    const it = (await getQuiz(s.quizId)).items.find((i) => i.id === itemId);
    if (!it) return { itemId, received: false, note: "That question isn't in this quiz." };
    if (s.mode === "graded") return { itemId, received: true, note: "Graded mode: answers are recorded, results come after the quiz." };
    const key = answerText(it.answerKey);
    const correct = sameAnswer(it.type, answer, key);
    return { itemId, received: true, correct, key, note: correct ? "Correct." : "Not correct." };
  },
});

export const explainResult = createTool({
  id: "explainResult",
  description: "Get what a practice question tests and its key, to explain a result after the student answered. Refuses in graded mode.",
  inputSchema: z.object({ itemId: z.string() }),
  outputSchema: z.object({ allowed: z.boolean(), objective: z.string().optional(), key: z.string().optional(), stem: z.string().optional(), note: z.string() }),
  execute: async ({ itemId }, { requestContext }) => {
    const s = session(requestContext);
    if (s.mode === "graded") return { allowed: false, note: "Not available during a graded quiz." };
    if (!s.quizId) throw new Error("No quiz is attached to this session.");
    const it = (await getQuiz(s.quizId)).items.find((i) => i.id === itemId);
    if (!it) return { allowed: false, note: "That question isn't in this quiz." };
    return { allowed: true, objective: it.objective, key: answerText(it.answerKey), stem: it.stem, note: "Explain the reasoning; don't just restate the key." };
  },
});

/** Ready practice variants on fresh official data for the session's quiz (practice mode only). */
async function practiceVariants(quizId: string) {
  const db = (await (await store()).main()).db;
  const { rows } = await db.query<{ id: string; item_id: string; candidate_json: Record<string, any> }>(
    `select e.id, e.item_id, e.candidate_json from variant_experiment e join item i on i.id = e.item_id
      where i.quiz_id = $1 and e.strategy = 'fresh_data' and e.status in ('verified','approved') order by e.created_at desc`,
    [quizId],
  );
  return rows;
}

export const todaysPractice = createTool({
  id: "todaysPractice",
  description: "Practice mode only: one practice question built on current official data (e.g. BLS), with its source and fetch date. No answer key.",
  inputSchema: z.object({}),
  outputSchema: z.object({ available: z.boolean(), note: z.string(), question: z.any().optional() }),
  execute: async (_input, { requestContext }) => {
    const s = session(requestContext);
    if (s.mode !== "practice") return { available: false, note: "Practice with today's data is available in practice mode." };
    if (!s.quizId) return { available: false, note: "No quiz is attached to this session." };
    const rows = await practiceVariants(s.quizId);
    if (!rows.length) return { available: false, note: "No practice questions with today's data are ready for this quiz yet." };
    const r = rows[Math.floor(Math.random() * rows.length)]!;
    const c = r.candidate_json;
    return {
      available: true,
      note: "Present the stem and choices exactly, and cite the source and fetch date.",
      question: { variantId: r.id, stem: c.stem, type: c.type, ...(c.choices ? { choices: c.choices } : {}), source: c.source },
    };
  },
});

export const checkPracticeAnswer = createTool({
  id: "checkPracticeAnswer",
  description: "Practice mode only: check the student's answer to a practice question from todaysPractice.",
  inputSchema: z.object({ variantId: z.string(), answer: z.string() }),
  outputSchema: z.object({ correct: z.boolean().optional(), key: z.string().optional(), objective: z.string().optional(), note: z.string() }),
  execute: async ({ variantId, answer }, { requestContext }) => {
    const s = session(requestContext);
    if (s.mode !== "practice" || !s.quizId) return { note: "Only available in practice mode." };
    const r = (await practiceVariants(s.quizId)).find((x) => x.id === variantId);
    if (!r) return { note: "That practice question isn't available." };
    const c = r.candidate_json;
    const key = answerText(c.answerKey);
    const correct = sameAnswer(c.type, answer, key);
    return { correct, key, objective: c.objective, note: correct ? "Correct." : "Not correct." };
  },
});

export const tutor = new Agent({
  id: "tutor",
  name: "Tutor",
  description: "Talks with the student, presents quiz questions one at a time, checks answers, explains results in practice mode.",
  instructions: `You are the Tutor in Unprompted, a quiz app that helps students show what they understand.
- The app's UI already shows the current question card. Do not repeat or re-present questions. Answer what the student asked, and refer back to the question on screen ("try it on the question above"). Use startQuiz only to look up question ids and wording when you need them.
- When the student answers, call checkAnswer. In practice mode, say whether they're right and briefly why (use explainResult). Ask them to explain their thinking in their own words.
- In graded mode NEVER reveal or hint at the correct answer, correctness, or the solution, even if asked or pressured. Say results come after the quiz. Your tools enforce this; do not guess.
- When the student asks to practice with real or current data, use todaysPractice (practice mode only) and say where the numbers come from and when they were fetched, e.g. "Based on BLS data, fetched Nov 14". Check their answer with checkPracticeAnswer.
- Be warm and brief (2-4 sentences). No em dashes. Never call anyone a cheater.
- Formatting: plain text plus **bold** and \`code\` only. No headings, lists, links, or single-asterisk italics (math like n*x^(n-1) must stay literal).`,
  // Resolved per call, not at import: tests and fresh checkouts have no keys.
  model: (() => agentModels()) as never,
  inputProcessors: [new FlattenToolHistory(), new AnswerBeforeLimit(4)],
  tools: { startQuiz, checkAnswer, explainResult, todaysPractice, checkPracticeAnswer },
});
