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
  | { type: "run_started"; mode: "live" | "replay"; label: string }
  | { type: "run_finished"; ok: boolean; message?: string }
);

/** The four "agents" shown in the right panel, in plain words. */
export type AgentName = "Rewriter" | "Quiz checker" | "Judge panel" | "Attack agents";
export const AGENT_ORDER: AgentName[] = ["Rewriter", "Quiz checker", "Judge panel", "Attack agents"];
export const AGENT_ROLE: Record<AgentName, string> = {
  Rewriter: "Writes question variants",
  "Quiz checker": "Solves each variant 3 times with code",
  "Judge panel": "3 models check the skill and wording",
  "Attack agents": "Browser agents retake the variants",
};

export type AgentStatus = "idle" | "thinking" | "working" | "needs-input" | "complete" | "error";

export interface AgentRow {
  name: AgentName;
  status: AgentStatus;
  activity: string;
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
  errors: string[];
}

export function initialRun(): RunState {
  const agents = Object.fromEntries(AGENT_ORDER.map((n) => [n, { name: n, status: "idle", activity: "Waiting" }])) as Record<AgentName, AgentRow>;
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
  const set = (n: AgentName, status: AgentStatus, activity: string) => (s.agents[n] = { name: n, status, activity });
  switch (e.type) {
    case "run_started":
      return { ...initialRun(), mode: e.mode, label: e.label, running: true };
    case "run_finished":
      s.running = false;
      s.finished = { ok: e.ok, message: e.message };
      for (const n of AGENT_ORDER) if (s.agents[n].status === "working" || s.agents[n].status === "thinking") set(n, "idle", "Done");
      return s;
    case "stage": {
      const c = card(s, e.experimentId, e.itemId, e.strategy);
      if (e.stage === "generating") {
        c.status = "generating";
        set("Rewriter", "thinking", `Writing ${short(e.experimentId)} (${strategyLabel(e.strategy)})`);
      } else if (e.stage === "solving") {
        c.status = "checking";
        set("Quiz checker", "working", `Solving ${short(e.experimentId)} 3 times`);
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
        set("Quiz checker", e.passed ? "complete" : "complete", `${short(e.experimentId)}: ${e.passed ? "key reproduced 3/3" : "key not reproduced"}`);
      } else if (e.total) {
        set("Judge panel", "complete", `${short(e.experimentId)}: ${e.agree}/${e.total} agree (${CHECK_LABEL[e.check]?.toLowerCase()})`);
      }
      return s;
    }
    case "attack_started":
      s.attack = { itemIds: e.itemIds };
      set("Attack agents", "working", `Re-testing ${e.itemIds.length} variant${e.itemIds.length === 1 ? "" : "s"}`);
      return s;
    case "attack_done":
      s.attack = { itemIds: s.attack?.itemIds ?? [], solveRates: e.solveRates };
      set(
        "Attack agents",
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
