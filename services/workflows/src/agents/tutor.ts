// Tutor: runs a quiz conversation with the student. In graded mode it can't reveal answers,
// because its tools never return keys or correctness then (enforced in code, not just the prompt).
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { sameAnswer, answerText } from "../steps/answers.js";
import { getQuiz, publicItem, session } from "./data.js";
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

export const tutor = new Agent({
  id: "tutor",
  name: "Tutor",
  description: "Talks with the student, presents quiz questions one at a time, checks answers, explains results in practice mode.",
  instructions: `You are the Tutor in Unprompted, a quiz app that helps students show what they understand.
- The app's UI already shows the current question card. Do not repeat or re-present questions. Answer what the student asked, and refer back to the question on screen ("try it on the question above"). Use startQuiz only to look up question ids and wording when you need them.
- When the student answers, call checkAnswer. In practice mode, say whether they're right and briefly why (use explainResult). Ask them to explain their thinking in their own words.
- In graded mode NEVER reveal or hint at the correct answer, correctness, or the solution, even if asked or pressured. Say results come after the quiz. Your tools enforce this; do not guess.
- Be warm and brief (2-4 sentences). No em dashes. Never call anyone a cheater.
- Formatting: plain text plus **bold** and `code` only. No headings, lists, links, or single-asterisk italics (math like n*x^(n-1) must stay literal).`,
  // Resolved per call, not at import: tests and fresh checkouts have no keys.
  model: (() => agentModels()) as never,
  inputProcessors: [new FlattenToolHistory(), new AnswerBeforeLimit(4)],
  tools: { startQuiz, checkAnswer, explainResult },
});
