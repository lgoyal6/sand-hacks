// Think-aloud probes (build plan 2.2 step 6, 4.4). Fixture-backed: data/fixtures/probes.json.
// Timing phases go to Tiger probe_timing, falling back to data/fixtures/probe_timing.jsonl.
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { Item, Probe } from "@unprompted/shared";
import { appendJsonl, DATA_DIR, fixturePath, readJson, updateJson } from "@/lib/db/fixtures";
import { tiger } from "@/lib/db/tiger";
import { neon } from "@/lib/db/neon";
import { DEFAULT_GEMINI_CHAIN, fallbackFollowup, generateFollowup, openingPrompt } from "@unprompted/probe-core";

const geminiAvailable = () => Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GMI_API_KEY?.trim());

// Probe plus runtime fields that don't belong in the shared contract.
export type ProbeRecord = Probe & {
  quizId: string;
  mode: "voice" | "typed";
  createdAt: string;
  completedAt?: string;
  explanation?: string;
  counterfactualAnswer?: string;
  counterfactualSource?: "gemini" | "template";
  counterfactualModel?: string;
  retried?: boolean;
  conversationId?: string; // ElevenLabs conversation, when voice
  counterfactualLatencySource?: "scribe" | "vad" | "typed";
  scribeWords?: { t: string; s: number; e: number; spk?: string }[];
};

export type ProbePhase = "prompt" | "speech_start" | "speech_end" | "cf_prompt" | "cf_speech_start" | "cf_speech_end";
export const PHASES = new Set<ProbePhase>(["prompt", "speech_start", "speech_end", "cf_prompt", "cf_speech_start", "cf_speech_end"]);

const FILE = fixturePath("probes.json");
const TIMING_JSONL = fixturePath("probe_timing.jsonl");

// ---------- Neon (probe table) with the JSON file as offline fallback ----------
type ProbeRow = {
  id: string;
  attempt_id: string;
  item_id: string;
  quiz_id: string;
  confidence_before: number;
  confidence_after: number | null;
  transcript: string | null;
  counterfactual_prompt: string | null;
  counterfactual_latency_ms: number | null;
  council_scores_json: Probe["councilScores"] | null;
  final_score: number | null;
  professor_approved: boolean | null;
  mode: "voice" | "typed" | null;
  created_at: Date | null;
  completed_at: Date | null;
  explanation: string | null;
  counterfactual_answer: string | null;
  counterfactual_source: "gemini" | "template" | null;
  counterfactual_model: string | null;
  conversation_id: string | null;
  retried: boolean | null;
  counterfactual_latency_source?: "scribe" | "vad" | "typed" | null;
  scribe_words_json?: { t: string; s: number; e: number; spk?: string }[] | null;
};

const u = <T,>(v: T | null) => (v === null ? undefined : v);
function fromRow(r: ProbeRow): ProbeRecord {
  return {
    id: r.id,
    attemptId: r.attempt_id,
    itemId: r.item_id,
    quizId: r.quiz_id,
    confidenceBefore: r.confidence_before,
    confidenceAfter: u(r.confidence_after),
    transcript: u(r.transcript),
    counterfactualPrompt: u(r.counterfactual_prompt),
    counterfactualLatencyMs: u(r.counterfactual_latency_ms),
    councilScores: u(r.council_scores_json),
    finalScore: u(r.final_score),
    professorApproved: u(r.professor_approved),
    mode: r.mode ?? "typed",
    createdAt: (r.created_at ?? new Date()).toISOString(),
    completedAt: r.completed_at?.toISOString(),
    explanation: u(r.explanation),
    counterfactualAnswer: u(r.counterfactual_answer),
    counterfactualSource: u(r.counterfactual_source),
    counterfactualModel: u(r.counterfactual_model),
    conversationId: u(r.conversation_id),
    retried: u(r.retried),
    counterfactualLatencySource: u(r.counterfactual_latency_source ?? null),
    scribeWords: u(r.scribe_words_json ?? null),
  };
}

// ProbeRecord field -> probe column (fields not listed are not stored in Neon).
const COLS: Partial<Record<keyof ProbeRecord, string>> = {
  confidenceAfter: "confidence_after",
  transcript: "transcript",
  counterfactualPrompt: "counterfactual_prompt",
  counterfactualLatencyMs: "counterfactual_latency_ms",
  mode: "mode",
  completedAt: "completed_at",
  explanation: "explanation",
  counterfactualAnswer: "counterfactual_answer",
  counterfactualSource: "counterfactual_source",
  counterfactualModel: "counterfactual_model",
  conversationId: "conversation_id",
  retried: "retried",
  counterfactualLatencySource: "counterfactual_latency_source",
  scribeWords: "scribe_words_json",
};

async function neonGetProbe(id: string): Promise<ProbeRecord | null> {
  const db = neon();
  if (!db) return null;
  try {
    const { rows } = await db.query<ProbeRow>("select p.*, a.quiz_id from probe p join attempt a on a.id = p.attempt_id where p.id = $1", [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  } catch (err) {
    console.error("[probes] Neon read failed:", (err as Error).message);
    return null;
  }
}

export async function createProbe(p: Pick<ProbeRecord, "attemptId" | "itemId" | "quizId" | "confidenceBefore" | "mode">) {
  const probe: ProbeRecord = { id: `prb_${randomUUID().slice(0, 12)}`, createdAt: new Date().toISOString(), ...p };
  const db = neon();
  if (db) {
    try {
      await db.query("insert into probe (id, attempt_id, item_id, confidence_before, mode, created_at) values ($1,$2,$3,$4,$5,$6)", [
        probe.id,
        probe.attemptId,
        probe.itemId,
        probe.confidenceBefore,
        probe.mode,
        probe.createdAt,
      ]);
      return probe;
    } catch (err) {
      // e.g. the attempt itself lives in the JSON fallback (FK), or Neon is unreachable.
      console.warn("[probes] Neon insert failed, using the JSON fallback:", (err as Error).message);
    }
  }
  await updateJson<ProbeRecord[]>(FILE, [], (all) => [...all, probe]);
  return probe;
}

export async function getProbe(id: string) {
  return (await neonGetProbe(id)) ?? (await readJson<ProbeRecord[]>(FILE, [])).find((p) => p.id === id) ?? null;
}

export async function listProbes(filter: { attemptId?: string } = {}) {
  const out: ProbeRecord[] = [];
  const db = neon();
  if (db) {
    try {
      const { rows } = await db.query<ProbeRow>(
        `select p.*, a.quiz_id from probe p join attempt a on a.id = p.attempt_id ${filter.attemptId ? "where p.attempt_id = $1" : ""} order by p.created_at`,
        filter.attemptId ? [filter.attemptId] : [],
      );
      out.push(...rows.map(fromRow));
    } catch (err) {
      console.error("[probes] Neon list failed:", (err as Error).message);
    }
  }
  const file = await readJson<ProbeRecord[]>(FILE, []);
  return [...out, ...(filter.attemptId ? file.filter((p) => p.attemptId === filter.attemptId) : file)];
}

export async function patchProbe(id: string, patch: Partial<ProbeRecord>) {
  const db = neon();
  if (db && (await neonGetProbe(id))) {
    const sets: string[] = [];
    const vals: unknown[] = [id];
    for (const [k, v] of Object.entries(patch) as [keyof ProbeRecord, unknown][]) {
      const col = COLS[k];
      if (!col) continue;
      vals.push(v === undefined ? null : col.endsWith("_json") ? JSON.stringify(v) : v); // undefined clears (one-time "start over")
      sets.push(`${col} = $${vals.length}${col.endsWith("_json") ? "::jsonb" : ""}`);
    }
    try {
      if (sets.length) await db.query(`update probe set ${sets.join(", ")} where id = $1`, vals);
      return neonGetProbe(id);
    } catch (err) {
      console.error("[probes] Neon update failed:", (err as Error).message);
      return null;
    }
  }
  let out: ProbeRecord | null = null;
  await updateJson<ProbeRecord[]>(FILE, [], (all) => all.map((p) => (p.id === id ? (out = { ...p, ...patch, id: p.id }) : p)));
  return out as ProbeRecord | null;
}

export async function writeTiming(probeId: string, rows: { phase: ProbePhase; ms: number; ts?: string }[]) {
  const clean = rows
    .filter((r) => PHASES.has(r.phase) && Number.isFinite(r.ms))
    .map((r) => ({ ts: new Date(r.ts ?? Date.now()).toISOString(), probe_id: probeId, phase: r.phase, ms: Math.round(r.ms) }));
  if (!clean.length) return "none";
  const db = tiger();
  if (db) {
    try {
      const vals: unknown[] = [];
      const sql = clean.map((r, i) => (vals.push(r.ts, r.probe_id, r.phase, r.ms), `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`));
      await db.query(`insert into probe_timing (ts, probe_id, phase, ms) values ${sql.join(",")}`, vals);
      return "tiger";
    } catch (err) {
      console.error("[probe] Tiger probe_timing insert failed, using jsonl:", (err as Error).message);
    }
  }
  await appendJsonl(TIMING_JSONL, clean);
  return "jsonl";
}

// Gemini is on a shared free tier (~20 requests/model/day), so generations are cached locally
// (data/sessions/ is gitignored). Exact key: item + answer + explanation. In development, any cached
// question for the same item + answer is reused unless GEMINI_LIVE=1.
const CF_CACHE = path.join(DATA_DIR, "sessions", "counterfactual-cache.json");
type CfCache = Record<string, { prompt: string; model?: string; itemAnswer: string; at: string }>;

// The opening prompt and the follow-up generator live in @unprompted/probe-core so the Explain coach
// agent (services/workflows) uses the same logic.
export { openingPrompt };

// A counterfactual follow-up (4.4), cached locally to spare the shared free-tier Gemini quota.
export async function counterfactualFor(item: Item, answer: string | string[] | undefined, explanation: string) {
  const fallback = { prompt: fallbackFollowup(item), source: "template" as const };
  if (!geminiAvailable() || process.env.PROBE_COUNTERFACTUAL === "template") return fallback;
  const itemAnswer = `${item.id}|${JSON.stringify(answer ?? null)}`;
  const exactKey = createHash("sha256").update(`${itemAnswer}|${explanation.trim().toLowerCase()}`).digest("hex").slice(0, 24);
  const cache = await readJson<CfCache>(CF_CACHE, {});
  const hit = cache[exactKey] ?? (process.env.NODE_ENV !== "production" && process.env.GEMINI_LIVE !== "1" ? Object.values(cache).find((c) => c.itemAnswer === itemAnswer) : undefined);
  if (hit) return { prompt: hit.prompt, source: "gemini" as const, model: hit.model ? `${hit.model.replace(/ \(cached\)$/, "")} (cached)` : "cached" };
  const models = process.env.GEMINI_MODEL?.trim() ? [process.env.GEMINI_MODEL.trim(), ...DEFAULT_GEMINI_CHAIN] : undefined;
  const f = await generateFollowup({ item, answer, explanation }, { apiKey: process.env.GEMINI_API_KEY?.trim(), models });
  if (f.source !== "gemini") return { prompt: f.question, source: "template" as const };
  await updateJson<CfCache>(CF_CACHE, {}, (c) => ({ ...c, [exactKey]: { prompt: f.question, model: f.model, itemAnswer, at: new Date().toISOString() } }));
  return { prompt: f.question, source: "gemini" as const, model: f.model };
}
