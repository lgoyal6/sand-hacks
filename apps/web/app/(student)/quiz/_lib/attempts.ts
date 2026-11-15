// Attempts and responses. Stored in Neon (attempt, response tables) when DATABASE_URL works;
// data/fixtures/attempts.json is the offline fallback. Reads check Neon first, then the file,
// so an attempt created in either store keeps working.
// Appeals: each Neon attempt records quiz_version (hash of the items shown) and the WAL LSN at start,
// so a Neon branch at quiz_snapshot_lsn shows exactly the questions the student saw.
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Quiz } from "@unprompted/shared";
import { fixturePath, readJson, updateJson } from "@/lib/db/fixtures";
import { neon } from "@/lib/db/neon";

export type AttemptMode = "practice" | "graded";

export interface ResponseRecord {
  id: string;
  attemptId: string;
  itemId: string;
  answer: string | string[];
  correct: boolean;
  seconds: number;
  answeredAt: string;
}

export interface AttemptRecord {
  id: string;
  studentPseudonym: string;
  quizId: string;
  mode: AttemptMode;
  startedAt: string;
  finishedAt?: string;
  consentAudio: boolean;
  userAgent?: string;
  responses: ResponseRecord[];
  // Server-only probe policy state. Never returned to the client.
  probePlan?: string[];
  probesTriggered?: string[];
  quizVersion?: string;
  store?: "neon" | "file";
}

const FILE = fixturePath("attempts.json");

export function quizVersion(quiz: Quiz) {
  const canon = quiz.items.map((i) => [i.id, i.stem, i.type, i.choices ?? null, i.answerKey]);
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex").slice(0, 16);
}

// ---------- Neon ----------
type AttemptRow = {
  id: string;
  student_pseudonym: string;
  quiz_id: string;
  mode: AttemptMode;
  started_at: Date;
  finished_at: Date | null;
  consent_audio: boolean;
  user_agent: string | null;
  probe_plan: string[] | null;
  probes_triggered: string[] | null;
  quiz_version: string | null;
};
type ResponseRow = { id: string; attempt_id: string; item_id: string; answer: string | string[]; correct: boolean; seconds: number; answered_at: Date | null };

function fromRows(a: AttemptRow, rs: ResponseRow[]): AttemptRecord {
  return {
    id: a.id,
    studentPseudonym: a.student_pseudonym,
    quizId: a.quiz_id,
    mode: a.mode,
    startedAt: a.started_at.toISOString(),
    finishedAt: a.finished_at?.toISOString(),
    consentAudio: a.consent_audio,
    userAgent: a.user_agent ?? undefined,
    probePlan: a.probe_plan ?? [],
    probesTriggered: a.probes_triggered ?? [],
    quizVersion: a.quiz_version ?? undefined,
    store: "neon",
    responses: rs.map((r) => ({
      id: r.id,
      attemptId: r.attempt_id,
      itemId: r.item_id,
      answer: r.answer,
      correct: r.correct,
      seconds: r.seconds,
      answeredAt: (r.answered_at ?? new Date()).toISOString(),
    })),
  };
}

async function neonGet(id: string): Promise<AttemptRecord | null> {
  const db = neon();
  if (!db) return null;
  try {
    const { rows } = await db.query<AttemptRow>("select * from attempt where id = $1", [id]);
    if (!rows[0]) return null;
    const rs = await db.query<ResponseRow>("select * from response where attempt_id = $1 order by answered_at", [id]);
    return fromRows(rows[0], rs.rows);
  } catch (err) {
    console.error("[attempts] Neon read failed:", (err as Error).message);
    return null;
  }
}

// ---------- API ----------
export async function createAttempt(input: {
  quiz: Quiz;
  mode: AttemptMode;
  studentPseudonym?: string;
  consentAudio?: boolean;
  userAgent?: string;
  probePlan?: string[];
}) {
  const attempt: AttemptRecord = {
    id: `att_${randomUUID().slice(0, 12)}`,
    studentPseudonym: input.studentPseudonym || `student-${randomUUID().slice(0, 6)}`,
    quizId: input.quiz.id,
    mode: input.mode,
    startedAt: new Date().toISOString(),
    consentAudio: Boolean(input.consentAudio),
    userAgent: input.userAgent,
    responses: [],
    probePlan: input.probePlan ?? [],
    probesTriggered: [],
    quizVersion: quizVersion(input.quiz),
  };
  const db = neon();
  if (db) {
    try {
      await db.query(
        `insert into attempt (id, student_pseudonym, quiz_id, mode, started_at, consent_audio, user_agent, probe_plan, probes_triggered, quiz_version, quiz_snapshot_lsn, quiz_snapshot_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10, pg_current_wal_lsn(), now())`,
        [attempt.id, attempt.studentPseudonym, attempt.quizId, attempt.mode, attempt.startedAt, attempt.consentAudio, attempt.userAgent ?? null, JSON.stringify(attempt.probePlan), "[]", attempt.quizVersion],
      );
      return { ...attempt, store: "neon" as const };
    } catch (err) {
      // Missing columns (schema not migrated yet) or a quiz not ingested into Neon: use the file.
      console.warn("[attempts] Neon insert failed, using the JSON fallback:", (err as Error).message);
    }
  }
  await updateJson<AttemptRecord[]>(FILE, [], (all) => [...all, { ...attempt, store: "file" }]);
  return { ...attempt, store: "file" as const };
}

export async function getAttempt(id: string): Promise<AttemptRecord | null> {
  const fromNeon = await neonGet(id);
  if (fromNeon) return fromNeon;
  const all = await readJson<AttemptRecord[]>(FILE, []);
  const a = all.find((x) => x.id === id);
  return a ? { ...a, store: "file" } : null;
}

export async function listAttempts(filter: { student?: string } = {}): Promise<AttemptRecord[]> {
  const out: AttemptRecord[] = [];
  const db = neon();
  if (db) {
    try {
      const { rows } = await db.query<AttemptRow>(
        filter.student ? "select * from attempt where student_pseudonym = $1 order by started_at" : "select * from attempt order by started_at",
        filter.student ? [filter.student] : [],
      );
      if (rows.length) {
        const rs = await db.query<ResponseRow>("select * from response where attempt_id = any($1) order by answered_at", [rows.map((r) => r.id)]);
        for (const a of rows) out.push(fromRows(a, rs.rows.filter((r) => r.attempt_id === a.id)));
      }
    } catch (err) {
      console.error("[attempts] Neon list failed:", (err as Error).message);
    }
  }
  const file = (await readJson<AttemptRecord[]>(FILE, [])).filter((a) => !filter.student || a.studentPseudonym === filter.student);
  return [...out, ...file.map((a) => ({ ...a, store: "file" as const }))];
}

export async function recordResponse(attemptId: string, r: Omit<ResponseRecord, "id" | "attemptId" | "answeredAt">) {
  const saved: ResponseRecord = { id: `resp_${randomUUID().slice(0, 12)}`, attemptId, answeredAt: new Date().toISOString(), ...r };
  const db = neon();
  if (db && (await neonGet(attemptId))) {
    try {
      // One response per item: a re-submit replaces the earlier one.
      await db.query("delete from response where attempt_id = $1 and item_id = $2", [attemptId, r.itemId]);
      await db.query("insert into response (id, attempt_id, item_id, answer, correct, seconds, answered_at) values ($1,$2,$3,$4::jsonb,$5,$6,$7)", [
        saved.id,
        attemptId,
        r.itemId,
        JSON.stringify(r.answer),
        r.correct,
        r.seconds,
        saved.answeredAt,
      ]);
      return saved;
    } catch (err) {
      console.error("[attempts] Neon response insert failed:", (err as Error).message);
      return null;
    }
  }
  let found = false;
  await updateJson<AttemptRecord[]>(FILE, [], (all) =>
    all.map((a) => {
      if (a.id !== attemptId) return a;
      found = true;
      return { ...a, responses: [...a.responses.filter((x) => x.itemId !== r.itemId), saved] };
    }),
  );
  return found ? saved : null;
}

export async function updateAttempt(attemptId: string, patch: Partial<Pick<AttemptRecord, "finishedAt" | "consentAudio" | "probesTriggered">>) {
  const db = neon();
  if (db && (await neonGet(attemptId))) {
    try {
      await db.query(
        `update attempt set
           finished_at = coalesce($2, finished_at),
           consent_audio = coalesce($3, consent_audio),
           probes_triggered = coalesce($4::jsonb, probes_triggered)
         where id = $1`,
        [attemptId, patch.finishedAt ?? null, patch.consentAudio ?? null, patch.probesTriggered ? JSON.stringify(patch.probesTriggered) : null],
      );
      return neonGet(attemptId);
    } catch (err) {
      console.error("[attempts] Neon update failed:", (err as Error).message);
      return null;
    }
  }
  let out: AttemptRecord | null = null;
  await updateJson<AttemptRecord[]>(FILE, [], (all) => all.map((a) => (a.id === attemptId ? (out = { ...a, ...patch }) : a)));
  return out as AttemptRecord | null;
}

// Accommodation (CONTRACTS: figure items): recorded on the attempt so the probe policy can honor it.
// The marker "acc:<itemId>" in probe_plan is authoritative (no schema change needed); the
// attempt.accommodations column, when present, gets a descriptive copy for D's exclusion and audits.
export async function addAccommodation(attemptId: string, itemId: string, kind: "figure_text") {
  const marker = `acc:${itemId}`;
  const entry = { itemId, kind, at: new Date().toISOString() };
  const db = neon();
  if (db && (await neonGet(attemptId))) {
    try {
      await db.query(
        `update attempt set probe_plan = case when probe_plan ? $2 then probe_plan else coalesce(probe_plan, '[]'::jsonb) || to_jsonb($2::text) end where id = $1`,
        [attemptId, marker],
      );
    } catch (err) {
      console.error("[attempts] accommodation marker failed:", (err as Error).message);
      return false;
    }
    await db.query(`update attempt set accommodations = coalesce(accommodations, '[]'::jsonb) || $2::jsonb where id = $1`, [attemptId, JSON.stringify([entry])]).catch(() => {});
    return true;
  }
  let found = false;
  await updateJson<AttemptRecord[]>(FILE, [], (all) =>
    all.map((a) => {
      if (a.id !== attemptId) return a;
      found = true;
      return { ...a, probePlan: [...new Set([...(a.probePlan ?? []), marker])] };
    }),
  );
  return found;
}
