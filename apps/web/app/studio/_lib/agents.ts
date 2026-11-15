// Client-safe model of the transform runner's event stream (owner: B).
// Mirrors TransformEvent in services/workflows/src/steps/types.ts; keep the two in sync.
import type { SolveRate, VariantExperiment, VariantStrategy } from "@unprompted/shared";

export type Stage = "generating" | "solving" | "judging" | "re-attacking" | "merging";

export type StudioEvent = { t?: number } & (
  | { type: "stage"; experimentId: string; itemId: string; strategy?: VariantStrategy; stage: Stage }
  | { type: "proposed"; experiment: VariantExperiment; rationale: string }
  | { type: "check"; experimentId: string; check: keyof VariantExperiment["checks"]; passed: boolean; detail: string; agree?: number; total?: number }
  | { type: "rejected"; experiment: VariantExperiment }
  | { type: "verified"; experiment: VariantExperiment }
  | { type: "attack_started"; quizId: string; itemIds: string[] }
  | { type: "attack_done"; quizId: string; solveRates: SolveRate[] }
  | { type: "error"; experimentId?: string; message: string }
  /** Sent by the studio run route, not the runner. */
  | { type: "run_started"; mode: "live" | "replay"; label: string; runId?: string }
  /** The Mastra workflow suspended: these verified variants wait for the professor. */
  | { type: "awaiting_approval"; runId: string; verified: string[] }
  | { type: "run_finished"; ok: boolean; message?: string }
);

/** The four "agents" shown in the right panel, in plain words. */
export type AgentName = "Rewriter" | "Answer checker" | "Judge panel" | "Quiz checker";
export const AGENT_ORDER: AgentName[] = ["Quiz checker", "Rewriter", "Answer checker", "Judge panel"];
/** Shared AgentIds (packages/shared) so D's AgentPanel and avatars recognize each agent. */
export const AGENT_IDS: Record<AgentName, string> = {
  "Quiz checker": "quiz-checker",
  Rewriter: "rewriter",
  "Answer checker": "answer-checker",
  "Judge panel": "judge-panel",
};
export const AGENT_ROLE: Record<AgentName, string> = {
  Rewriter: "Writes question variants",
  "Answer checker": "Solves each variant 3 times with code",
  "Judge panel": "3 Gemini models check the skill and wording",
  "Quiz checker": "Browser agents take the quiz",
};

export type AgentStatus = "idle" | "thinking" | "working" | "needs-input" | "complete" | "error";

export interface AgentRow {
  name: AgentName;
  status: AgentStatus;
  activity: string;
  /** Recent activity, newest last (shown when the panel row is expanded). */
  steps: { text: string; at?: string }[];
}

export type CardStatus = "generating" | "checking" | "re-attacking" | "verified" | "rejected" | "unverified" | "approved";

export interface VariantCard {
  id: string;
  itemId: string;
  k: number;
  strategy?: VariantStrategy;
  status: CardStatus;
  experiment?: VariantExperiment;
  rationale?: string;
  checks: { label: string; passed: boolean; detail: string }[];
  reason?: string;
}

export interface RunState {
  mode?: "live" | "replay";
  label?: string;
  running: boolean;
  finished?: { ok: boolean; message?: string };
  agents: Record<AgentName, AgentRow>;
  cards: Record<string, VariantCard>;
  order: string[];
  attack?: { itemIds: string[]; solveRates?: SolveRate[] };
  /** Mastra workflow run id, when the run went through Mastra. */
  runId?: string;
  /** Set while the workflow is suspended for the professor's decision. */
  awaiting?: string[];
  errors: string[];
}

export function initialRun(): RunState {
  const agents = Object.fromEntries(AGENT_ORDER.map((n): [AgentName, AgentRow] => [n, { name: n, status: "idle", activity: "Waiting", steps: [] }])) as Record<AgentName, AgentRow>;
  return { running: false, agents, cards: {}, order: [], errors: [] };
}

export function variantNumber(id: string): number {
  return Number(id.match(/-v(\d+)$/)?.[1] ?? 0);
}

const STRATEGY_LABEL: Record<VariantStrategy, string> = {
  isomorphic: "new numbers",
  application: "real-world setting",
  find_error: "find the error",
  figure_dependency: "table lookup",
  counterfactual: "what-if",
};
export function strategyLabel(s?: VariantStrategy) {
  return s ? STRATEGY_LABEL[s] : "variant";
}

const CHECK_LABEL: Record<string, string> = {
  answerKeyConsistent: "Answer key reproduced",
  objectivePreserved: "Same skill",
  unambiguous: "One clear answer",
  newSolveRate: "Agents fail it",
};

function card(s: RunState, id: string, itemId: string, strategy?: VariantStrategy): VariantCard {
  if (!s.cards[id]) {
    s.cards[id] = { id, itemId, k: variantNumber(id), strategy, status: "generating", checks: [] };
    s.order.push(id);
  }
  if (strategy && !s.cards[id].strategy) s.cards[id].strategy = strategy;
  return s.cards[id];
}

function short(id: string) {
  const c = id.match(/-q(\d+)-v(\d+)$/);
  return c ? `Q${c[1]} variant ${c[2]}` : id;
}

/** Pure reducer: fold one event into the run state. */
export function reduceRun(prev: RunState, e: StudioEvent): RunState {
  const s: RunState = structuredClone(prev);
  const at = e.t != null ? `${Math.round(e.t / 1000)}s` : undefined;
  const set = (n: AgentName, status: AgentStatus, activity: string) => {
    const prevRow = s.agents[n];
    const steps = activity === prevRow.activity ? prevRow.steps : [...prevRow.steps, { text: activity, at }].slice(-6);
    s.agents[n] = { name: n, status, activity, steps };
  };
  switch (e.type) {
    case "run_started":
      return { ...initialRun(), mode: e.mode, label: e.label, running: true, runId: e.runId };
    case "awaiting_approval":
      s.runId = e.runId;
      s.awaiting = e.verified;
      return s;
    case "run_finished":
      s.running = false;
      s.finished = { ok: e.ok, message: e.message };
      for (const n of AGENT_ORDER) {
        const a = s.agents[n];
        if (a.status === "working" || a.status === "thinking") s.agents[n] = { ...a, status: "idle" };
      }
      for (const id of s.order) {
        const c = s.cards[id]!;
        if (c.status === "generating" || c.status === "checking" || c.status === "re-attacking") {
          c.status = "unverified";
          c.reason = "The run ended before this variant was decided.";
        }
      }
      return s;
    case "stage": {
      const c = card(s, e.experimentId, e.itemId, e.strategy);
      if (e.stage === "generating") {
        c.status = "generating";
        set("Rewriter", "thinking", `Writing ${short(e.experimentId)} (${strategyLabel(e.strategy)})`);
      } else if (e.stage === "solving") {
        c.status = "checking";
        set("Answer checker", "working", `Solving ${short(e.experimentId)} 3 times`);
      } else if (e.stage === "judging") {
        c.status = "checking";
        set("Judge panel", "working", `Reviewing ${short(e.experimentId)}`);
      } else if (e.stage === "re-attacking") {
        c.status = "re-attacking";
      }
      return s;
    }
    case "proposed": {
      const c = card(s, e.experiment.id, e.experiment.itemId, e.experiment.strategy);
      c.experiment = e.experiment;
      c.rationale = e.rationale;
      c.status = "checking";
      set("Rewriter", "complete", `Wrote ${short(e.experiment.id)}`);
      return s;
    }
    case "check": {
      const c = s.cards[e.experimentId];
      if (!c) return s;
      c.checks.push({ label: CHECK_LABEL[e.check] ?? e.check, passed: e.passed, detail: e.detail });
      if (e.check === "answerKeyConsistent") {
        set("Answer checker", e.passed ? "complete" : "complete", `${short(e.experimentId)}: ${e.passed ? "key reproduced 3/3" : "key not reproduced"}`);
      } else {
        // Older recordings have no vote counts; their detail reads "panel 3/3: ...".
        const m = e.detail.match(/panel (\d+)\/(\d+)/);
        const agree = e.agree ?? (m ? Number(m[1]) : undefined);
        const total = e.total ?? (m ? Number(m[2]) : undefined);
        set("Judge panel", "complete", `${short(e.experimentId)}: ${agree != null && total ? `${agree}/${total} agree` : e.passed ? "agrees" : "disagrees"} (${CHECK_LABEL[e.check]?.toLowerCase()})`);
      }
      return s;
    }
    case "attack_started":
      s.attack = { itemIds: e.itemIds };
      set("Quiz checker", "working", `Re-testing ${e.itemIds.length} variant${e.itemIds.length === 1 ? "" : "s"}`);
      return s;
    case "attack_done":
      s.attack = { itemIds: s.attack?.itemIds ?? [], solveRates: e.solveRates };
      set(
        "Quiz checker",
        "complete",
        e.solveRates.map((r) => `${short(r.itemId)}: ${r.correct}/${r.runs}`).join(", ") || "No runs",
      );
      return s;
    case "verified":
    case "rejected": {
      const c = card(s, e.experiment.id, e.experiment.itemId, e.experiment.strategy);
      c.experiment = e.experiment;
      c.status = e.type;
      c.reason = e.experiment.reasons.at(-1);
      return s;
    }
    case "error": {
      if (e.experimentId && s.cards[e.experimentId]) {
        const c = s.cards[e.experimentId];
        if (e.message.startsWith("not verified")) {
          c.status = "unverified";
          c.reason = e.message.replace(/^not verified: /, "");
        }
      } else {
        s.errors.push(e.message);
      }
      return s;
    }
  }
}

/** Cards for experiments already stored (no live run), so the thread shows past results. */
export function cardsFromExperiments(experiments: VariantExperiment[]): VariantCard[] {
  return experiments.map((e) => ({
    id: e.id,
    itemId: e.itemId,
    k: variantNumber(e.id),
    strategy: e.strategy,
    experiment: e,
    status: e.status === "proposed" ? "unverified" : e.status === "approved" ? "approved" : e.status,
    reason: e.reasons.at(-1),
    checks: Object.entries(e.checks)
      .filter(([k, v]) => v !== undefined && k !== "newSolveRate")
      .map(([k, v]) => ({ label: CHECK_LABEL[k] ?? k, passed: Boolean(v), detail: "" })),
  }));
}
