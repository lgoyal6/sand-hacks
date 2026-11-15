// Data for the professor dashboards (owner: D). Server only.
// Reads real producer outputs from data/fixtures (A: agent runs, D: leaks, B: variants, C: attempts/probes)
// and live session features from Tiger when TIGER_DATABASE_URL is set. Never invents numbers:
// a panel with no data renders an empty state.
import "server-only";
import { statSync } from "node:fs";
import type { AgentRun, LeakFinding, Probe, Quiz, SolveRate, VariantExperiment } from "@unprompted/shared";
import { fixturePath, readJson } from "@/lib/db/fixtures";
import { tiger } from "@/lib/db/tiger";

export interface AttackSummary {
  quizId: string;
  itemRuns: number;
  itemCorrect: number;
  accuracy: number;
  accuracyCI95: [number, number];
  attempts: number;
  attemptsCompleted: number;
  infraErrors: number;
  byAgentModel: Record<string, { itemRuns: number; accuracy: number }>;
  runs: { runId: string; agent: string; model: string; seconds: number; steps: number; score: number | null; answerChanges?: Record<string, number> }[];
}

export interface AttemptRow {
  id: string;
  studentPseudonym: string;
  quizId: string;
  mode?: string;
  startedAt?: string;
  responses?: { itemId: string; answer: unknown; correct: boolean; seconds?: number }[];
}

export interface SessionFeatures {
  attempt_id: string;
  items: number;
  keys: number;
  pastes: number;
  clicks: number;
  clicks_no_move: number;
  click_no_move_ratio: number | null;
  answers: number;
  answers_without_item_input: number;
  answer_no_input_ratio: number | null;
  answers_in_dead_range: number;
  key_dt_cv: number | null;
  ms_away: number;
  webdriver: boolean | null;
  botd_bot: boolean | null;
}

export interface Source<T> {
  data: T;
  /** "fixture" with the file's modified time, "tiger" for live, or "none" when the producer hasn't written anything. */
  origin: "fixture" | "tiger" | "none";
  updatedAt?: string;
}

function mtime(name: string): string | undefined {
  try {
    return statSync(fixturePath(name)).mtime.toISOString();
  } catch {
    return undefined;
  }
}

async function fixture<T>(name: string, empty: T): Promise<Source<T>> {
  const updatedAt = mtime(name);
  if (!updatedAt) return { data: empty, origin: "none" };
  return { data: await readJson<T>(fixturePath(name), empty), origin: "fixture", updatedAt };
}

export const loadQuiz = () => fixture<Quiz | null>("quiz-sample-stats.json", null);
export const loadSolveRates = () => fixture<SolveRate[]>("solve_rates.json", []);
export const loadAgentRuns = () => fixture<AgentRun[]>("agent_runs.json", []);
export const loadAttackSummary = () => fixture<AttackSummary | null>("attack_summary.json", null);
export const loadLeaks = () => fixture<LeakFinding[]>("leaks.json", []);
export const loadVariants = () => fixture<VariantExperiment[]>("variants.json", []);
export const loadAttempts = () => fixture<AttemptRow[]>("attempts.json", []);
export const loadProbes = () => fixture<Probe[]>("probes.json", []);

export async function loadSessions(): Promise<Source<SessionFeatures[]>> {
  const pool = tiger();
  if (!pool) return { data: [], origin: "none" };
  try {
    const { rows } = await pool.query<SessionFeatures>(
      `select attempt_id, items::int, keys::int, pastes::int, clicks::int, clicks_no_move::int, click_no_move_ratio,
              answers::int, answers_without_item_input::int, answer_no_input_ratio, answers_in_dead_range::int,
              key_dt_cv, ms_away::float8 as ms_away, webdriver, botd_bot
       from attempt_features order by attempt_id`,
    );
    return { data: rows, origin: "tiger", updatedAt: new Date().toISOString() };
  } catch (e) {
    console.error("[professor] Tiger attempt_features failed:", (e as Error).message);
    return { data: [], origin: "none" };
  }
}

/** "Q1"… labels in quiz order, plus a short stem for tooltips. */
export function itemLabels(quiz: Quiz | null): Map<string, { label: string; stem: string; objective: string }> {
  const m = new Map<string, { label: string; stem: string; objective: string }>();
  quiz?.items.forEach((it, i) => m.set(it.id, { label: `Q${i + 1}`, stem: it.stem, objective: it.objective }));
  return m;
}
