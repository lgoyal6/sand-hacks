// The demo course. A single course until B's Canvas import provides real ones.
// Due dates and assignment metadata are demo values for the LMS shell.
export const COURSE = { id: "stats-101", name: "Intro Statistics", term: "Fall 2026" } as const;

export interface Assignment {
  id: string;
  title: string;
  kind: "quiz" | "practice";
  quizId?: string;
  due: string; // ISO date
  points: number;
  description: string;
}

export const ASSIGNMENTS: Assignment[] = [
  {
    id: "a-practice-1",
    title: "Practice: Sampling and inference",
    kind: "practice",
    quizId: "sample-stats",
    due: "2026-11-17",
    points: 0,
    description: "Unlimited tries. Includes a short think-aloud so you can check your own understanding.",
  },
  {
    id: "a-quiz-1",
    title: "Quiz 1: Sampling and inference",
    kind: "quiz",
    quizId: "sample-stats",
    due: "2026-11-19",
    points: 10,
    description: "5 questions. Up to 2 short think-aloud follow-ups (10% of the quiz).",
  },
];

export function formatDue(iso: string) {
  return new Date(`${iso}T23:59:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + " at 11:59pm";
}
