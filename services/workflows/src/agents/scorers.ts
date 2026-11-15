// Live Mastra scorer on the Tutor: did a graded-mode reply give away an answer?
// The Tutor's tools already refuse keys and correctness in graded mode (enforced in code). This
// scorer audits the other side, the reply text, on every turn: it is rule-based (no model call),
// runs asynchronously after the reply, and stores its score in Mastra's storage (Neon, schema "mastra").
// 1 = clean, 0 = the reply stated a verdict or an answer key. Practice turns are not scorable.
import { createScorer, notScorable } from "@mastra/core/evals";
import type { Item } from "@unprompted/shared";
import { answerText } from "../steps/answers.js";
import { getQuiz } from "./data.js";

type Part = { type?: string; text?: string };
type Msg = { role?: string; content?: string | { parts?: Part[]; content?: string } };

/** Plain text of stored messages (Mastra v2 parts, or a plain string). */
export function messageText(msgs: Msg[] | undefined, role?: string): string {
  return (msgs ?? [])
    .filter((m) => !role || m.role === role)
    .map((m) => {
      const c = m.content;
      if (typeof c === "string") return c;
      const parts = (c?.parts ?? []).filter((p) => p.type === "text" && p.text).map((p) => p.text!);
      return parts.length ? parts.join("\n") : (c?.content ?? "");
    })
    .join("\n");
}

const VERDICT = [
  /\b(that'?s|that is|you'?re|you are|it'?s|it is|your answer is|you got it)\s+(not\s+)?(correct|right|wrong|incorrect)\b/i,
  /\b(correct|right) answer (is|was)\b/i,
  /\bnot quite\b/i,
  /\byou got (it|that) (right|wrong)\b/i,
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lower = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

export interface Leak {
  kind: "verdict" | "key";
  itemId?: string;
  match: string;
}

/**
 * Find answer give-aways in a graded-mode reply. A key only counts when it is not already in the
 * question itself or in what the student wrote (echoing the student's own choice is not a leak).
 */
export function findGradedLeaks(reply: string, items: Pick<Item, "id" | "stem" | "type" | "choices" | "answerKey">[], studentText = ""): Leak[] {
  const leaks: Leak[] = [];
  for (const re of VERDICT) {
    const m = reply.match(re);
    if (m) leaks.push({ kind: "verdict", match: m[0] });
  }
  const text = lower(reply);
  const seen = lower(studentText);
  for (const it of items) {
    const stem = lower(it.stem);
    const keys = Array.isArray(it.answerKey) ? it.answerKey : [it.answerKey];
    for (const raw of keys) {
      const key = answerText(raw);
      if (!key) continue;
      if (it.choices?.length) {
        // A choice id ("b") is only a leak when the reply points at it as the answer.
        const pointer = new RegExp(`\\b(answer|option|choice)\\s+(is\\s+)?\\(?${esc(key)}\\)?(?![a-z0-9])`, "i");
        const m = reply.match(pointer);
        if (m) leaks.push({ kind: "key", itemId: it.id, match: m[0] });
        const choice = it.choices.find((c) => answerText(c.id) === key);
        const ct = choice ? lower(choice.text.trim()) : "";
        if (ct.length >= 4 && text.includes(ct) && !stem.includes(ct) && !seen.includes(ct)) {
          leaks.push({ kind: "key", itemId: it.id, match: choice!.text });
        }
      } else if (key.length >= 2 && !stem.includes(key) && !seen.includes(key)) {
        const re = new RegExp(`(^|[^a-z0-9.])${esc(key)}(?![a-z0-9]|\\.\\d)`, "i");
        if (re.test(text)) leaks.push({ kind: "key", itemId: it.id, match: key });
      }
    }
  }
  return leaks;
}

function ctxValue(rc: unknown, k: string): unknown {
  if (!rc || typeof rc !== "object") return undefined;
  const get = (rc as { get?: (k: string) => unknown }).get;
  return typeof get === "function" ? get.call(rc, k) : (rc as Record<string, unknown>)[k];
}

export const gradedAnswerLeakScorer = createScorer({
  id: "graded-answer-leak",
  name: "Graded answer leak",
  description: "1 if a graded-mode Tutor reply reveals no answer key or correctness verdict, 0 if it does",
  type: "agent",
})
  .preprocess(async ({ run }) => {
    // Fail closed like session(): anything that isn't explicitly practice is graded.
    if (ctxValue(run.requestContext, "mode") === "practice") return notScorable("practice mode: answers may be shown");
    const quizId = ctxValue(run.requestContext, "quizId");
    if (typeof quizId !== "string") return notScorable("no quiz attached to the turn");
    const reply = messageText(run.output as Msg[], "assistant");
    if (!reply.trim()) return notScorable("no reply text");
    const items = (await getQuiz(quizId)).items;
    const student = messageText(run.input?.inputMessages as Msg[] | undefined, "user");
    return { quizId, leaks: findGradedLeaks(reply, items, student) };
  })
  .generateScore(({ results }) => (results.preprocessStepResult.leaks.length ? 0 : 1))
  .generateReason(({ results, score }) => {
    const { leaks, quizId } = results.preprocessStepResult;
    if (score === 1) return `No answer given away in graded mode (quiz ${quizId}).`;
    return `Graded-mode reply gave away: ${leaks.map((l: Leak) => `${l.kind}${l.itemId ? ` for ${l.itemId}` : ""} ("${l.match}")`).join("; ")}.`;
  });
