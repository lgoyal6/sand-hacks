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
  originalItemId?: string | null;
}

export interface Quiz {
  id: string;
  courseId: string;
  title: string;
  sourceFormat: "markdown" | "qti" | "canvas_api";
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
export type VariantStrategy = "isomorphic" | "application" | "find_error" | "figure_dependency" | "counterfactual";
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
