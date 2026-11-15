// Professor class roster data (owner C; UI by D at /professor/students). Server only, role-checked by callers.
// Pseudonyms only: never emails or names. Mastery framing: signals are evidence for a conversation.
import "server-only";
import { neon } from "@/lib/db/neon";

export interface ClassStudent {
  pseudonym: string;
  attempts: { attemptId: string; quizId: string; mode: "practice" | "graded"; startedAt: string; finishedAt: string | null; score: number; total: number; accommodations: unknown[] }[];
  responses: { attemptId: string; itemId: string; correct: boolean; seconds: number }[];
  probes: {
    probeId: string;
    attemptId: string;
    itemId: string;
    mode: string | null;
    finalScore: number | null;
    professorApproved: boolean;
    confidenceBefore: number;
    confidenceAfter: number | null;
    counterfactualLatencyMs: number | null;
    latencySource: string | null;
    explainSignals: unknown;
    completedAt: string | null;
  }[];
}

export async function loadClassProgress(opts: { quizId?: string; pseudonym?: string } = {}): Promise<ClassStudent[]> {
  const db = neon();
  if (!db) return [];
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.quizId) where.push(`a.quiz_id = $${args.push(opts.quizId)}`);
  if (opts.pseudonym) where.push(`a.student_pseudonym = $${args.push(opts.pseudonym)}`);
  const w = where.length ? `where ${where.join(" and ")}` : "";
  const [att, resp, probes] = await Promise.all([
    db.query<{ id: string; student_pseudonym: string; quiz_id: string; mode: "practice" | "graded"; started_at: Date; finished_at: Date | null; delivered_item_ids: string[] | null; accommodations: unknown[] | null }>(
      `select a.id, a.student_pseudonym, a.quiz_id, a.mode, a.started_at, a.finished_at, a.delivered_item_ids, a.accommodations from attempt a ${w} order by a.started_at`,
      args,
    ),
    db.query<{ attempt_id: string; item_id: string; correct: boolean; seconds: number }>(
      `select r.attempt_id, r.item_id, r.correct, r.seconds from response r join attempt a on a.id = r.attempt_id ${w}`,
      args,
    ),
    db.query<{
      id: string; attempt_id: string; item_id: string; mode: string | null; final_score: number | null; professor_approved: boolean | null;
      confidence_before: number; confidence_after: number | null; counterfactual_latency_ms: number | null; counterfactual_latency_source: string | null;
      explain_signals_json: unknown; completed_at: Date | null; student_pseudonym: string;
    }>(
      `select p.id, p.attempt_id, p.item_id, p.mode, p.final_score, p.professor_approved, p.confidence_before, p.confidence_after,
              p.counterfactual_latency_ms, p.counterfactual_latency_source, p.explain_signals_json, p.completed_at, a.student_pseudonym
         from probe p join attempt a on a.id = p.attempt_id ${w} order by p.created_at`,
      args,
    ),
  ]);
  const by = new Map<string, ClassStudent>();
  const get = (ps: string) => {
    let s = by.get(ps);
    if (!s) by.set(ps, (s = { pseudonym: ps, attempts: [], responses: [], probes: [] }));
    return s;
  };
  const pseudoOf = new Map(att.rows.map((a) => [a.id, a.student_pseudonym]));
  for (const a of att.rows) {
    const rs = resp.rows.filter((r) => r.attempt_id === a.id);
    get(a.student_pseudonym).attempts.push({
      attemptId: a.id,
      quizId: a.quiz_id,
      mode: a.mode,
      startedAt: a.started_at.toISOString(),
      finishedAt: a.finished_at?.toISOString() ?? null,
      score: rs.filter((r) => r.correct).length,
      total: a.delivered_item_ids?.length || rs.length,
      accommodations: a.accommodations ?? [],
    });
  }
  for (const r of resp.rows) {
    const ps = pseudoOf.get(r.attempt_id);
    if (ps) get(ps).responses.push({ attemptId: r.attempt_id, itemId: r.item_id, correct: r.correct, seconds: r.seconds });
  }
  for (const p of probes.rows)
    get(p.student_pseudonym).probes.push({
      probeId: p.id,
      attemptId: p.attempt_id,
      itemId: p.item_id,
      mode: p.mode,
      finalScore: p.final_score,
      professorApproved: Boolean(p.professor_approved),
      confidenceBefore: p.confidence_before,
      confidenceAfter: p.confidence_after,
      counterfactualLatencyMs: p.counterfactual_latency_ms,
      latencySource: p.counterfactual_latency_source,
      explainSignals: p.explain_signals_json,
      completedAt: p.completed_at?.toISOString() ?? null,
    });
  return [...by.values()];
}
