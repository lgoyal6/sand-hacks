// Client-safe quiz shapes (no answer keys). Mirrors PublicQuiz in app/(student)/quiz/_lib/quizzes.ts.
import type { Item, Quiz } from "@unprompted/shared";

export type PublicItem = Omit<Item, "answerKey">;
export type PublicQuiz = Omit<Quiz, "items"> & { items: PublicItem[] };
export type Mode = "practice" | "graded";
export type Answer = string | string[];
