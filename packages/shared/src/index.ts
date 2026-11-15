// Shared contracts between workstreams. Change only by agreement (see docs/CONTRACTS.md).

export type ItemType = "mcq" | "multi" | "numeric" | "short";

export interface Item {
  id: string;
  quizId: string;
  stem: string;
  type: ItemType;
  choices?: { id: string; text: string }[];
  answerKey: string | string[];
  objective: string;
  /** "inferred": guessed at import (Canvas title or a stem excerpt), so the professor must confirm it before a
   *  rewrite. "professor": written or confirmed by the professor. Absent = authored with the quiz (Markdown). */
  objectiveSource?: "inferred" | "professor";
  originalItemId?: string | null;
  // Optional figure. When present, data needed to answer may live only in the image; see the accessibility
  // accommodation in docs/CONTRACTS.md (an accessible version reveals the data plus a think-aloud probe).
  figure?: { src: string; alt: string };
}

export interface Quiz {
  id: string;
  courseId: string;
  title: string;
  sourceFormat: "markdown" | "qti" | "canvas_api" | "course_site";
  items: Item[];
}

// Workstream A -> everyone
export type AgentName = "browser-use" | "stagehand" | "skyvern";
export interface AgentRun {
  id: string;
  quizId: string;
  itemId: string;
  agent: AgentName;
  model: string;
  correct: boolean;
  seconds: number;
  steps: number;
  runAt: string; // ISO
}
export interface SolveRate {
  itemId: string;
  runs: number;
  correct: number;
  solveRate: number; // correct / runs
  agentSolvable: boolean; // solveRate >= 0.6
}

// Workstream D -> everyone
export interface LeakFinding {
  id: string;
  itemId: string;
  query: string;
  url: string;
  sourceType: "quizlet" | "reddit" | "chegg" | "coursehero" | "other";
  snippet: string;
  screenshotUrl?: string;
  foundAt: string;
  matchScore: number; // 0..1
}

// Workstream B
export type VariantStatus = "proposed" | "verified" | "rejected" | "approved";
/** fresh_data = a PRACTICE variant built on current official data (learning material, never delivered as a graded replacement). */
export type VariantStrategy = "isomorphic" | "application" | "find_error" | "figure_dependency" | "counterfactual" | "fresh_data";
export interface VariantExperiment {
  id: string;
  itemId: string;
  neonBranch: string; // exp/<item>/<n>
  strategy: VariantStrategy;
  candidate: Omit<Item, "id" | "quizId">;
  status: VariantStatus;
  checks: {
    answerKeyConsistent?: boolean;
    objectivePreserved?: boolean;
    unambiguous?: boolean;
    newSolveRate?: number;
    /** Leak check on the rewritten stem (D's scan, at most 2 searches): true = not found online. */
    leakFree?: boolean;
    /** Hosts where the rewritten stem was found, when leakFree is false. */
    leakSources?: string[];
  };
  reasons: string[];
}

// Workstream C
export type InteractionKind = "key" | "paste" | "focus" | "blur" | "pointer" | "scroll" | "select" | "answer";
export interface InteractionEvent {
  ts: string;
  attemptId: string;
  itemId?: string;
  kind: InteractionKind;
  payload: Record<string, unknown>;
}
export interface Probe {
  id: string;
  attemptId: string;
  itemId: string;
  confidenceBefore: number; // 1..7
  confidenceAfter?: number; // 1..7
  transcript?: string;
  counterfactualPrompt?: string;
  counterfactualLatencyMs?: number;
  councilScores?: { model: string; score: number; evidence: string }[];
  finalScore?: number; // 0..4
  professorApproved?: boolean;
}

// Workstream D dashboards
export interface ExplainGapCell {
  studentPseudonym: string;
  itemId: string;
  correct: boolean;
  understanding: number | null; // 0..4
  quadrant: "correct_explained" | "explain_gap" | "near_miss" | "wrong_unexplained";
}
export interface SessionFlag {
  attemptId: string;
  agentLikelihood: number; // 0..1, evidence only, never a verdict
  topFeatures: { name: string; value: number }[];
}

// Agent activity, one shape for every agent (Mastra agents, A's attack runner, B's transform),
// rendered by D's AgentPanel and the chat threads. Agreed in docs/CONTRACTS.md.
export type AgentEventStatus = "idle" | "thinking" | "running" | "needs-input" | "done" | "error";
export type AgentId =
  | "supervisor"
  | "tutor"
  | "explain-coach"
  | "researcher"
  | "quiz-checker"
  | "rewriter"
  | "judge-panel"
  | "leak-scout"
  | (string & {});
export interface AgentEvent {
  agentId: AgentId;
  status: AgentEventStatus;
  /** One human line, present tense: "Run 2/9: browser-use is taking the quiz". */
  label: string;
  toolCall?: { name: string; args?: Record<string, unknown>; result?: unknown };
  /** ISO timestamp. */
  ts: string;
}
/** AgentEventStatus -> the AgentState / AgentPanel `state` prop. */
export const AGENT_EVENT_STATE: Record<AgentEventStatus, "idle" | "thinking" | "working" | "needs-input" | "complete" | "error"> = {
  idle: "idle",
  thinking: "thinking",
  running: "working",
  "needs-input": "needs-input",
  done: "complete",
  error: "error",
};

/**
 * The canonical record of a quiz as served, for integrity fingerprints (attempt start, appeals, the
 * Solana notary). Hash it with canonical JSON (sorted keys) + SHA-256, i.e. `fingerprint()` in
 * apps/web/lib/notary. Items in served order; approved variants appear under their own ids.
 */
export function quizVersionRecord(quizId: string, items: Pick<Item, "id" | "stem" | "type" | "choices" | "answerKey">[]) {
  return {
    v: 1,
    quizId,
    items: items.map((i) => ({ id: i.id, stem: i.stem, type: i.type, choices: i.choices ?? null, answerKey: i.answerKey })),
  };
}
