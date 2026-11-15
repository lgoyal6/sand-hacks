// Students roster data (owner: D) on C's loadClassProgress. Server only; the professor layout gates the pages
// and the approve route checks the role itself. Pseudonyms only. Everything here is evidence for a
// conversation with the student, never a verdict, and nothing here changes a grade on its own.
import "server-only";
import { loadClassProgress, type ClassStudent } from "@/app/(student)/_lib/class";
import { neon } from "@/lib/db/neon";
import { getQuiz } from "@/app/(student)/quiz/_lib/quizzes";
import { whoFromPseudonym } from "@/components/dashboard/session-signals";
import { describe, type FieldSignals } from "../_data";

export type Who = ReturnType<typeof whoFromPseudonym>;

export interface Calibration {
  /** Mean confidence (rescaled 0-100) minus percent correct on the same questions. Positive = more sure than right. */
  gap: number;
  n: number;
  label: "Matches results" | "More confident than results" | "Less confident than results";
}

export interface RosterRow {
  pseudonym: string;
  who: Who;
  attempts: number;
  latest: { score: number; total: number; mode: "practice" | "graded"; at: string } | null;
  thinkAlouds: number;
  thinkAloudAvg: number | null;
  calibration: Calibration | null;
  awaitingApproval: number;
  accommodated: boolean;
  followUp: string | null;
  lastActive: string | null;
}

const conf01 = (c: number) => (Math.min(7, Math.max(1, c)) - 1) / 6;

export function calibrationOf(s: ClassStudent): Calibration | null {
  const pairs = s.probes
    .map((p) => {
      const r = s.responses.find((x) => x.attemptId === p.attemptId && x.itemId === p.itemId);
      return r && Number.isFinite(p.confidenceBefore) ? { c: conf01(p.confidenceBefore), ok: r.correct ? 1 : 0 } : null;
    })
    .filter((x): x is { c: number; ok: number } => x !== null);
  if (pairs.length < 2) return null;
  const gap = Math.round((pairs.reduce((a, p) => a + p.c, 0) / pairs.length - pairs.reduce((a, p) => a + p.ok, 0) / pairs.length) * 100);
  return { gap, n: pairs.length, label: Math.abs(gap) < 20 ? "Matches results" : gap > 0 ? "More confident than results" : "Less confident than results" };
}

const isAccommodated = (s: ClassStudent, attemptId: string, itemId: string) =>
  s.attempts.some((a) => a.attemptId === attemptId && (a.accommodations as { itemId?: string }[]).some((x) => x?.itemId === itemId));

/** One neutral, concrete next step for the professor, or null. Never mentions misconduct. */
export function followUpFor(s: ClassStudent, label: (attemptId: string, itemId: string) => string): string | null {
  for (const p of s.probes) {
    if (p.mode !== "typed" || isAccommodated(s, p.attemptId, p.itemId) || !p.explainSignals) continue;
    if (describe(p.explainSignals as Record<string, FieldSignals>).notes.length)
      return `Ask for a short spoken explanation of ${label(p.attemptId, p.itemId)}; the typed one came in without much typing.`;
  }
  for (const p of s.probes) {
    const r = s.responses.find((x) => x.attemptId === p.attemptId && x.itemId === p.itemId);
    if (r?.correct && p.finalScore != null && p.finalScore <= 1) return `Ask them to walk through ${label(p.attemptId, p.itemId)}: right answer, explanation scored ${p.finalScore}/4.`;
  }
  const cal = calibrationOf(s);
  if (cal && cal.gap >= 30) return "Go over the missed questions together; they felt sure about them.";
  return null;
}

/** Delivered-order labels (Q1, Q2, ...) per attempt, from what was actually served. */
export async function itemOrder(attemptIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const db = neon();
  if (!db || !attemptIds.length) return out;
  const { rows } = await db.query<{ id: string; delivered_item_ids: string[] | null }>("select id, delivered_item_ids from attempt where id = any($1)", [attemptIds]);
  for (const r of rows) out.set(r.id, r.delivered_item_ids ?? []);
  return out;
}

export function labeler(order: Map<string, string[]>) {
  return (attemptId: string, itemId: string) => {
    const i = order.get(attemptId)?.indexOf(itemId) ?? -1;
    return i >= 0 ? `Q${i + 1}` : "a question";
  };
}

function rowOf(s: ClassStudent, label: (attemptId: string, itemId: string) => string): RosterRow {
  const finished = s.attempts.filter((a) => a.finishedAt);
  const last = (finished.length ? finished : s.attempts).at(-1);
  const done = s.probes.filter((p) => p.completedAt);
  const scored = done.filter((p) => p.finalScore != null);
  const times = [...s.attempts.map((a) => a.finishedAt ?? a.startedAt), ...s.probes.map((p) => p.completedAt)].filter(Boolean) as string[];
  return {
    pseudonym: s.pseudonym,
    who: whoFromPseudonym(s.pseudonym),
    attempts: s.attempts.length,
    latest: last ? { score: last.score, total: last.total, mode: last.mode, at: last.finishedAt ?? last.startedAt } : null,
    thinkAlouds: done.length,
    thinkAloudAvg: scored.length ? Math.round((scored.reduce((a, p) => a + (p.finalScore ?? 0), 0) / scored.length) * 10) / 10 : null,
    calibration: calibrationOf(s),
    awaitingApproval: scored.filter((p) => !p.professorApproved).length,
    accommodated: s.attempts.some((a) => a.accommodations.length > 0),
    followUp: followUpFor(s, label),
    lastActive: times.sort().at(-1) ?? null,
  };
}

export async function loadRoster(): Promise<RosterRow[]> {
  const students = await loadClassProgress();
  const order = await itemOrder(students.flatMap((s) => s.attempts.map((a) => a.attemptId)));
  const label = labeler(order);
  return students
    .map((s) => rowOf(s, label))
    .sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));
}

export interface SeenItem {
  id: string;
  label: string;
  stem: string;
  type: string;
  choices: { id: string; text: string }[];
  answerKey: string | string[] | null;
  isVariant: boolean;
  figureAlt: string | null;
}

export interface ProbeDetail {
  probeId: string;
  mode: string;
  confidenceBefore: number;
  confidenceAfter: number | null;
  explanation: string | null;
  transcript: string | null;
  counterfactualPrompt: string | null;
  counterfactualAnswer: string | null;
  counterfactualLatencyMs: number | null;
  finalScore: number | null;
  professorApproved: boolean;
  notes: string[];
  accommodated: boolean;
  /** Retention: when the ElevenLabs call audio was deleted, and when the professor deleted our transcript. */
  audioDeletedAt: string | null;
  transcriptDeletedAt: string | null;
  /** A voice call exists at ElevenLabs (or did), so there is audio to delete. */
  hadCall: boolean;
}

export interface AttemptDetail {
  attemptId: string;
  quizId: string;
  mode: "practice" | "graded";
  startedAt: string;
  finishedAt: string | null;
  score: number;
  total: number;
  accommodations: number;
  items: (SeenItem & { answer: unknown; correct: boolean | null; seconds: number | null; probe: ProbeDetail | null })[];
}

export async function loadStudent(pseudonym: string): Promise<{ row: RosterRow; attempts: AttemptDetail[] } | null> {
  const [s] = await loadClassProgress({ pseudonym });
  const db = neon();
  if (!s || !db) return null;
  const ids = s.attempts.map((a) => a.attemptId);
  const order = await itemOrder(ids);
  const label = labeler(order);
  const itemIds = [...new Set([...order.values()].flat())];
  const [items, answers, probes] = await Promise.all([
    db.query<{ id: string; stem: string; type: string; choices_json: { id: string; text: string }[] | null; answer_key: string | string[] | null; original_item_id: string | null; figure_json: { alt?: string } | null }>(
      "select id, stem, type, choices_json, answer_key, original_item_id, figure_json from item where id = any($1)",
      [itemIds],
    ),
    db.query<{ attempt_id: string; item_id: string; answer: unknown }>("select attempt_id, item_id, answer from response where attempt_id = any($1)", [ids]),
    // select *: audio_deleted_at / transcript_deleted_at may not exist until the retention columns are added.
    db.query<{ id: string; explanation: string | null; transcript: string | null; counterfactual_prompt: string | null; counterfactual_answer: string | null; audio_deleted_at?: Date | null; transcript_deleted_at?: Date | null; conversation_id?: string | null }>(
      "select * from probe where attempt_id = any($1)",
      [ids],
    ),
  ]);
  const itemById = new Map(items.rows.map((r) => [r.id, r]));
  // Items served from a file-backed quiz aren't in Neon's item table: fall back to C's quiz loader.
  for (const qid of new Set(s.attempts.map((a) => a.quizId))) {
    const q = await getQuiz(qid).catch(() => null);
    for (const it of q?.items ?? [])
      if (!itemById.has(it.id))
        itemById.set(it.id, { id: it.id, stem: it.stem, type: it.type, choices_json: it.choices ?? null, answer_key: it.answerKey, original_item_id: it.originalItemId ?? null, figure_json: it.figure ? { alt: it.figure.alt } : null });
  }
  const textById = new Map(probes.rows.map((r) => [r.id, r]));
  const row = rowOf(s, label);
  const attempts = [...s.attempts].reverse().map((a): AttemptDetail => {
    const delivered = order.get(a.attemptId)?.length ? order.get(a.attemptId)! : s.responses.filter((r) => r.attemptId === a.attemptId).map((r) => r.itemId);
    return {
      attemptId: a.attemptId,
      quizId: a.quizId,
      mode: a.mode,
      startedAt: a.startedAt,
      finishedAt: a.finishedAt,
      score: a.score,
      total: a.total,
      accommodations: a.accommodations.length,
      items: delivered.map((itemId, i) => {
        const it = itemById.get(itemId);
        const r = s.responses.find((x) => x.attemptId === a.attemptId && x.itemId === itemId);
        const p = s.probes.find((x) => x.attemptId === a.attemptId && x.itemId === itemId);
        const t = p ? textById.get(p.probeId) : undefined;
        const accommodated = isAccommodated(s, a.attemptId, itemId) || p?.mode === "accommodation";
        return {
          id: itemId,
          label: `Q${i + 1}`,
          stem: it?.stem ?? "(question text not found)",
          type: it?.type ?? "unknown",
          choices: it?.choices_json ?? [],
          answerKey: it?.answer_key ?? null,
          isVariant: Boolean(it?.original_item_id),
          figureAlt: it?.figure_json?.alt ?? null,
          answer: answers.rows.find((x) => x.attempt_id === a.attemptId && x.item_id === itemId)?.answer ?? null,
          correct: r ? r.correct : null,
          seconds: r ? r.seconds : null,
          probe: p
            ? {
                probeId: p.probeId,
                mode: accommodated ? "accommodation" : (p.mode ?? "typed"),
                confidenceBefore: p.confidenceBefore,
                confidenceAfter: p.confidenceAfter,
                explanation: t?.explanation ?? null,
                transcript: t?.transcript ?? null,
                counterfactualPrompt: t?.counterfactual_prompt ?? null,
                counterfactualAnswer: t?.counterfactual_answer ?? null,
                counterfactualLatencyMs: p.counterfactualLatencyMs,
                finalScore: p.finalScore,
                professorApproved: p.professorApproved,
                // Accommodations are never checked.
                notes: !accommodated && p.mode === "typed" && p.explainSignals ? describe(p.explainSignals as Record<string, FieldSignals>).notes : [],
                accommodated,
                audioDeletedAt: t?.audio_deleted_at?.toISOString() ?? null,
                transcriptDeletedAt: t?.transcript_deleted_at?.toISOString() ?? null,
                hadCall: Boolean(t?.conversation_id),
              }
            : null,
        };
      }),
    };
  });
  return { row, attempts };
}
