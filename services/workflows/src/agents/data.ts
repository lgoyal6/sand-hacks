// Read-only quiz access for agents (Neon main, or the in-memory fallback without keys).
import type { Item, Quiz } from "@unprompted/shared";
import { openBranchStore } from "../db/index.js";
import type { BranchStore } from "../db/types.js";
import { loadQuiz } from "../ingest/markdown.js";

let storePromise: Promise<BranchStore> | null = null;
export function store(): Promise<BranchStore> {
  storePromise ??= openBranchStore();
  return storePromise;
}

const cache = new Map<string, { quiz: Quiz; at: number }>();
export async function getQuiz(quizId: string): Promise<Quiz> {
  const hit = cache.get(quizId);
  if (hit && Date.now() - hit.at < 60_000) return hit.quiz;
  const quiz = await loadQuiz((await (await store()).main()).db, quizId);
  cache.set(quizId, { quiz, at: Date.now() });
  return quiz;
}

/** What a model may see of an item: never the answer key. */
export function publicItem(it: Item) {
  return { id: it.id, stem: it.stem, type: it.type, ...(it.choices ? { choices: it.choices } : {}), objective: it.objective };
}

/** Session facts come from the server (request context), never from the model's tool arguments. */
export interface SessionContext {
  quizId?: string;
  mode: "practice" | "graded";
}
export function session(requestContext: { get: (k: string) => unknown } | undefined): SessionContext {
  const mode = requestContext?.get("mode") === "practice" ? "practice" : "graded"; // fail closed
  const quizId = requestContext?.get("quizId");
  return { mode, quizId: typeof quizId === "string" ? quizId : undefined };
}
