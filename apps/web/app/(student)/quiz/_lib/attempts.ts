// Attempts and responses. Fixture-backed (data/fixtures/attempts.json) until Neon is wired.
import "server-only";
import { randomUUID } from "node:crypto";
import { fixturePath, readJson, updateJson } from "@/lib/db/fixtures";

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
}

const FILE = fixturePath("attempts.json");

export async function createAttempt(input: { quizId: string; mode: AttemptMode; studentPseudonym?: string; consentAudio?: boolean; userAgent?: string }) {
  const attempt: AttemptRecord = {
    id: `att_${randomUUID().slice(0, 12)}`,
    studentPseudonym: input.studentPseudonym || `student-${randomUUID().slice(0, 6)}`,
    quizId: input.quizId,
    mode: input.mode,
    startedAt: new Date().toISOString(),
    consentAudio: Boolean(input.consentAudio),
    userAgent: input.userAgent,
    responses: [],
  };
  await updateJson<AttemptRecord[]>(FILE, [], (all) => [...all, attempt]);
  return attempt;
}

export async function getAttempt(id: string) {
  const all = await readJson<AttemptRecord[]>(FILE, []);
  return all.find((a) => a.id === id) ?? null;
}

export async function recordResponse(attemptId: string, r: Omit<ResponseRecord, "id" | "attemptId" | "answeredAt">) {
  let saved: ResponseRecord | null = null;
  await updateJson<AttemptRecord[]>(FILE, [], (all) =>
    all.map((a) => {
      if (a.id !== attemptId) return a;
      saved = { id: `resp_${randomUUID().slice(0, 12)}`, attemptId, answeredAt: new Date().toISOString(), ...r };
      // One response per item: a re-submit replaces the earlier one.
      return { ...a, responses: [...a.responses.filter((x) => x.itemId !== r.itemId), saved] };
    }),
  );
  return saved as ResponseRecord | null;
}

export async function updateAttempt(attemptId: string, patch: Partial<Pick<AttemptRecord, "finishedAt" | "consentAudio">>) {
  let out: AttemptRecord | null = null;
  await updateJson<AttemptRecord[]>(FILE, [], (all) =>
    all.map((a) => (a.id === attemptId ? (out = { ...a, ...patch }) : a)),
  );
  return out as AttemptRecord | null;
}
