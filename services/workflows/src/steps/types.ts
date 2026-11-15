import type { Item, Quiz, SolveRate, VariantExperiment, VariantStrategy } from "@unprompted/shared";

export type Candidate = Omit<Item, "id" | "quizId"> & {
  /** Shown to students and agents as an image only (A's sandbox renders item.figure). */
  figure?: { src: string; alt: string };
  /** The figure's data as text, for the answer checker and judges only. Stripped before any agent sees the item. */
  figureText?: string;
};

/** What the generator returns: a candidate plus its own explanation (kept for the professor). */
export interface GeneratedCandidate {
  candidate: Candidate;
  rationale: string;
  generator: string; // model name
}

export interface Generator {
  generate(source: Item, strategy: VariantStrategy, attempt: number): Promise<GeneratedCandidate>;
}

export interface SolveResult {
  answer: string; // normalized final answer as text
  usedCode: boolean;
  model: string;
}

/** Solves a candidate independently of the generator (code interpreter allowed). */
export interface Solver {
  /** `run` (0-based) distinguishes the independent repeats, so each gets its own cache entry. */
  solve(candidate: Candidate, run?: number): Promise<SolveResult>;
}

export interface PanelVote {
  judge: string; // model name of this seat
  objectivePreserved: boolean;
  unambiguous: boolean;
  reason: string;
}

/** One seat of the three-LLM objective/ambiguity panel. */
export interface Judge {
  name: string;
  vote(source: Item, candidate: Candidate): Promise<PanelVote>;
}

/** Workstream A's attack(): runs real browser agents against a quiz in our sandbox. */
export interface Attacker {
  attack(quiz: Quiz, itemIds: string[]): Promise<AttackResult>;
}

export interface AttackResult {
  /** Solve rates over VALID runs only: the agent submitted, and no provider error. */
  solveRates: SolveRate[];
  /** Runs left out, so nobody mistakes "didn't finish" or "provider failed" for "couldn't solve". */
  excluded?: { unsubmitted: number; providerErrors: number; unisolated?: number; wrongQuiz?: number; total: number };
}

export interface TransformDeps {
  generator: Generator;
  solver: Solver;
  judges: Judge[];
  attacker: Attacker;
}

export interface TransformTarget {
  item: Item;
  /** Original agent solve rate (from A's solve_rates.json). */
  solveRate: number;
  leaked?: boolean;
}

export interface TransformOptions {
  candidatesPerItem?: number; // N, default 3
  strategies?: VariantStrategy[];
  solveRepeats?: number; // default 3
  /** Survival rule (build plan 4.2 step 5). */
  maxNewSolveRate?: number; // default 0.3
  minDrop?: number; // default 0.4
  /** Delete branches of rejected candidates (Neon free plan caps branch count). Reasons stay on main. */
  pruneRejectedBranches?: boolean;
  concurrency?: number; // per-item parallelism for generate/solve/panel, default 2
  onEvent?: (e: TransformEvent) => void;
}

export type TransformStage = "generating" | "solving" | "judging" | "re-attacking" | "merging";

export type TransformEvent =
  /** A step started; lets a UI show live work ("Rewriter · generating") before a result exists. */
  | { type: "stage"; experimentId: string; itemId: string; strategy?: VariantStrategy; stage: TransformStage }
  | { type: "proposed"; experiment: VariantExperiment; rationale: string }
  | {
      type: "check";
      experimentId: string;
      check: keyof VariantExperiment["checks"];
      passed: boolean;
      detail: string;
      /** Panel checks: how many seats agreed, out of how many. */
      agree?: number;
      total?: number;
    }
  | { type: "rejected"; experiment: VariantExperiment }
  | { type: "verified"; experiment: VariantExperiment }
  | { type: "attack_started"; quizId: string; itemIds: string[] }
  | { type: "attack_done"; quizId: string; solveRates: SolveRate[]; excluded?: AttackResult["excluded"] }
  | { type: "error"; experimentId?: string; message: string };

export interface TransformResult {
  experiments: VariantExperiment[];
  /** Items for which no candidate survived: these get probe priority instead (build plan 4.2, "Honesty"). */
  probePriority: string[];
}
