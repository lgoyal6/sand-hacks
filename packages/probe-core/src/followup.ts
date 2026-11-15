// The think-aloud counterfactual follow-up (build plan 4.4), as a plain function.
// Used by the student runtime (apps/web) and by the Explain coach agent's generateFollowup tool
// (services/workflows). Pure: no filesystem, no framework; caching is the caller's job.
import type { Item } from "@unprompted/shared";
import { geminiJson, type GeminiOptions } from "./gemini";

export const FALLBACK_FOLLOWUP = "Good. Now suppose one number in the problem changed, say it doubled. What would happen to your answer, and why?";

// Generic "what if" follow-ups per question type, for when Gemini is unavailable (quota, outage).
export function fallbackFollowup(item: Pick<Item, "type">): string {
  switch (item.type) {
    case "numeric":
      return "Suppose one of the numbers in the problem doubled. What would happen to your answer, and why?";
    case "mcq":
    case "multi":
      return "Pick one of the other options. What would have to be different about the problem for that one to be right?";
    default:
      return "What is one change to the situation in the question that would change your answer? Walk me through why.";
  }
}

export interface FollowupInput {
  item: Item; // needs the answer key: only call server-side
  answer: string | string[] | undefined;
  explanation: string;
}

export interface Followup {
  question: string;
  changed?: string; // what was perturbed
  source: "gemini" | "template";
  model?: string;
}

export function describeAnswer(item: Pick<Item, "choices">, answer: string | string[] | undefined) {
  if (answer === undefined) return "(no answer recorded)";
  const ids = Array.isArray(answer) ? answer : [answer];
  if (!item.choices) return String(answer);
  return ids.map((id) => `${id.toUpperCase()}) ${item.choices!.find((c) => c.id === id)?.text ?? "?"}`).join("; ");
}

// The opening prompt quotes the student's own answer back, without saying whether it was right.
export function openingPrompt(item: Pick<Item, "choices">, answer: string | string[] | undefined) {
  return `You answered ${describeAnswer(item, answer)}. Walk me through how you got there, as if you were explaining it to a friend.`;
}

export function buildFollowupPrompt({ item, answer, explanation }: FollowupInput) {
  return [
    "You write ONE spoken follow-up question for a short think-aloud check in an intro course.",
    "Goal: test whether the student holds a working model of the problem, not whether they memorized the answer.",
    "Rules:",
    "- Change exactly one parameter, condition, or assumption of the ORIGINAL question (e.g. the sample size doubles, a value becomes negative, the test becomes one-sided), or ask which step would break.",
    "- Perturb an INPUT of the problem (data, sample, setup), never the quantity the student must reason about. The question must not contain its own answer.",
    "- The new answer must follow from the same reasoning as the original. Answerable in 20-40 seconds by talking, without a calculator.",
    "- Build on the student's own answer and words where possible. Don't reveal whether their answer was right. Don't include the answer.",
    "- Warm, plain, one or two sentences, under 40 words. No preamble like 'Great job'.",
    "",
    `Learning objective: ${item.objective || "(not given)"}`,
    `Original question: ${item.stem}`,
    item.choices ? `Choices: ${item.choices.map((c) => `${c.id}) ${c.text}`).join(" | ")}` : "",
    `Answer key (for your reasoning only, never reveal): ${Array.isArray(item.answerKey) ? item.answerKey.join(",") : item.answerKey}`,
    `Student's answer: ${describeAnswer(item, answer)}`,
    `Student's explanation: ${explanation.trim().slice(0, 2000) || "(none)"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export const FOLLOWUP_SCHEMA = {
  type: "object",
  properties: { question: { type: "string" }, changed: { type: "string", description: "what was perturbed" } },
  required: ["question", "changed"],
} as const;

// Never throws. Each model in the chain: Gemini direct, or the same model via GMI on 429 / 503 / timeout (and
// while the direct key cools down), then the next model; finally a template per question type.
export async function generateFollowup(
  input: FollowupInput,
  gemini: Partial<GeminiOptions> & { gmi?: { apiKey?: string; baseUrl?: string } } = {},
): Promise<Followup> {
  const env = typeof process !== "undefined" ? process.env : ({} as Record<string, string | undefined>);
  const apiKey = gemini.apiKey ?? env.GEMINI_API_KEY?.trim() ?? "";
  const prompt = buildFollowupPrompt(input);
  const accept = (out: { question?: string; changed?: string; _model: string }): Followup | null => {
    const q = out.question?.trim();
    return q && q.length <= 400 ? { question: q, changed: out.changed, source: "gemini", model: out._model } : null;
  };
  try {
    const ok = accept(
      await geminiJson<{ question: string; changed: string }>(prompt, FOLLOWUP_SCHEMA, {
        ...gemini,
        apiKey,
        jsonHint: 'Return JSON: {"question": string, "changed": string}',
      }),
    );
    if (ok) return ok;
  } catch (err) {
    console.warn("[probe-core] Gemini follow-up failed on every route:", (err as Error).message);
  }
  return { question: fallbackFollowup(input.item), source: "template" };
}
