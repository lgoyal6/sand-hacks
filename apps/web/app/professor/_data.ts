// Data for the professor dashboards (owner: D). Server only.
// Reads real producer outputs from data/fixtures (A: agent runs, D: leaks, B: variants, C: attempts/probes)
// and live session features from Tiger when TIGER_DATABASE_URL is set. Never invents numbers:
// a panel with no data renders an empty state.
import "server-only";
import { statSync } from "node:fs";
import type { AgentRun, LeakFinding, Probe, Quiz, SolveRate, VariantExperiment } from "@unprompted/shared";
import { fixturePath, readJson } from "@/lib/db/fixtures";
import { tiger } from "@/lib/db/tiger";
import { neon } from "@/lib/db/neon";

export interface AttackSummary {
  quizId: string;
  itemRuns: number;
  itemCorrect: number;
  accuracy: number;
  accuracyCI95: [number, number];
  attempts: number;
  attemptsCompleted: number;
  infraErrors: number;
  infraReasons?: Record<string, number>;
  /** true = every run came from a sandboxed agent (no answer keys, secrets or open web). */
  isolated?: boolean;
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
export const loadArchiveWatch = () =>
  fixture<{ runAt: string; items: { itemId: string; candidates: number }[] } | null>("archive_watch.json", null);
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

/** studentPseudonym per attempt id: Neon (C's attempt table) when configured, else the attempts fixture. */
export async function loadPseudonyms(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const pool = neon();
  if (pool && ids.length) {
    try {
      const { rows } = await pool.query<{ id: string; student_pseudonym: string }>("select id, student_pseudonym from attempt where id = any($1)", [ids]);
      for (const r of rows) out.set(r.id, r.student_pseudonym);
    } catch (e) {
      console.error("[professor] Neon attempt lookup failed:", (e as Error).message);
    }
  }
  if (out.size < ids.length) {
    const fx = await loadAttempts();
    for (const a of fx.data) if (!out.has(a.id)) out.set(a.id, a.studentPseudonym);
  }
  return out;
}

interface FieldSignals {
  keys?: number;
  charsTyped?: number;
  finalLength?: number;
  pastes?: number;
  pastedChars?: number;
  inputEvents?: number;
  nonKeyInputEvents?: number;
  keyIntervalMedianMs?: number | null;
  keyIntervalIqrMs?: number | null;
}

export interface ProbeEvidence {
  probeId: string;
  attemptId: string;
  student: string;
  itemId: string;
  mode: "voice" | "typed" | "accommodation";
  score: number | null;
  chars: number;
  keys: number;
  pastedChars: number;
  /** Characters that arrived without keystrokes or a paste (script-set values). */
  untypedChars: number;
  medianKeyMs: number | null;
  /** Neutral notes for the professor; empty when the text was typed normally. Never a verdict. */
  notes: string[];
  evidence: "voice" | "typed" | "no text" | "excluded (accommodation)";
}

/** Combine C's per-field signals (explanation + follow-up) into neutral notes. */
function describe(sig: Record<string, FieldSignals | undefined>): Pick<ProbeEvidence, "chars" | "keys" | "pastedChars" | "untypedChars" | "medianKeyMs" | "notes"> {
  const f = Object.values(sig).filter(Boolean) as FieldSignals[];
  const sum = (k: keyof FieldSignals) => f.reduce((n, x) => n + (Number(x[k]) || 0), 0);
  const chars = sum("finalLength");
  const keys = sum("keys");
  const typed = sum("charsTyped");
  const pastedChars = sum("pastedChars");
  const untypedChars = Math.max(0, chars - typed - pastedChars);
  const medians = f.map((x) => x.keyIntervalMedianMs).filter((v): v is number => typeof v === "number");
  const iqrs = f.map((x) => x.keyIntervalIqrMs).filter((v): v is number => typeof v === "number");
  const medianKeyMs = medians.length ? Math.round(medians.reduce((a, b) => a + b, 0) / medians.length) : null;
  const notes: string[] = [];
  if (untypedChars >= Math.max(10, chars * 0.3)) notes.push(`${untypedChars} characters typed without keystrokes`);
  if (pastedChars > 0) notes.push(`pasted ${pastedChars} characters`);
  if (keys >= 20 && medianKeyMs != null && medianKeyMs < 40 && (iqrs.length ? Math.max(...iqrs) : 0) < 25) notes.push(`very fast, even typing (median ${medianKeyMs} ms between keys)`);
  return { chars, keys, pastedChars, untypedChars, medianKeyMs, notes };
}

/**
 * Think-aloud explanations with their mode and typing evidence. Prefers C's probe.explain_signals_json
 * (per-field keys, typed/pasted/final lengths, key timing); falls back to counting key and paste events in
 * Tiger for older probes. Evidence for a follow-up conversation, never a verdict.
 */
export async function loadProbeEvidence(limit = 30): Promise<Source<ProbeEvidence[]>> {
  const n = neon();
  if (!n) return { data: [], origin: "none" };
  try {
    const { rows } = await n.query<{
      id: string; attempt_id: string; item_id: string; mode: string | null; final_score: number | null; chars: number;
      student_pseudonym: string; accommodations: { itemId?: string }[] | null; signals: Record<string, FieldSignals> | null;
    }>(
      `select p.id, p.attempt_id, p.item_id, p.mode, p.final_score,
              length(coalesce(p.explanation, '')) + length(coalesce(p.counterfactual_answer, '')) as chars,
              a.student_pseudonym, a.accommodations, p.explain_signals_json as signals
       from probe p join attempt a on a.id = p.attempt_id
       where coalesce(p.explanation, '') <> '' or p.mode = 'voice'
       order by p.created_at desc limit $1`,
      [limit],
    );
    const t = tiger();
    const counts = new Map<string, { keys: number; pastes: number }>();
    const needFallback = rows.filter((r) => !r.signals).map((r) => r.attempt_id);
    if (t && needFallback.length) {
      const ev = await t.query<{ attempt_id: string; keys: number; pastes: number }>(
        `select attempt_id, count(*) filter (where kind = 'key')::int keys, count(*) filter (where kind = 'paste')::int pastes
         from interaction_events where attempt_id = any($1) and payload->>'target' in ('probe-explanation', 'probe-cf-answer')
         group by attempt_id`,
        [[...new Set(needFallback)]],
      );
      for (const e of ev.rows) counts.set(e.attempt_id, { keys: e.keys, pastes: e.pastes });
    }
    const data = rows.map((r): ProbeEvidence => {
      const accommodated = r.mode === "accommodation" || (r.accommodations ?? []).some((a) => a?.itemId === r.item_id);
      const mode: ProbeEvidence["mode"] = accommodated ? "accommodation" : r.mode === "voice" ? "voice" : "typed";
      const base = { probeId: r.id, attemptId: r.attempt_id, student: r.student_pseudonym, itemId: r.item_id, mode, score: r.final_score };
      if (mode !== "typed") {
        return { ...base, chars: Number(r.chars), keys: 0, pastedChars: 0, untypedChars: 0, medianKeyMs: null, notes: [], evidence: mode === "voice" ? "voice" : "excluded (accommodation)" };
      }
      let d: ReturnType<typeof describe>;
      if (r.signals) d = describe(r.signals);
      else {
        // Older probes: estimate from Tiger key counts (keys ~ characters typed; pastes counted, size unknown).
        const c = counts.get(r.attempt_id) ?? { keys: 0, pastes: 0 };
        const chars = Number(r.chars);
        d = describe({ explanation: { keys: c.keys, charsTyped: c.keys, finalLength: chars, pastes: c.pastes, pastedChars: c.pastes ? Math.max(0, chars - c.keys) : 0 } });
      }
      return { ...base, ...d, evidence: d.chars === 0 ? "no text" : "typed" };
    });
    return { data, origin: "tiger", updatedAt: new Date().toISOString() };
  } catch (e) {
    console.error("[professor] probe evidence failed:", (e as Error).message);
    return { data: [], origin: "none" };
  }
}
