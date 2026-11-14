// Think-aloud probes (build plan 2.2 step 6, 4.4). Fixture-backed: data/fixtures/probes.json.
// Timing phases go to Tiger probe_timing, falling back to data/fixtures/probe_timing.jsonl.
import "server-only";
import { randomUUID } from "node:crypto";
import type { Item, Probe } from "@unprompted/shared";
import { appendJsonl, fixturePath, readJson, updateJson } from "@/lib/db/fixtures";
import { tiger } from "@/lib/db/tiger";
import { geminiAvailable, geminiJson } from "./gemini";

// Probe plus runtime fields that don't belong in the shared contract.
export type ProbeRecord = Probe & {
  quizId: string;
  mode: "voice" | "typed";
  createdAt: string;
  completedAt?: string;
  explanation?: string;
  counterfactualAnswer?: string;
  counterfactualSource?: "gemini" | "template";
  retried?: boolean;
  conversationId?: string; // ElevenLabs conversation, when voice
};

export type ProbePhase = "prompt" | "speech_start" | "speech_end" | "cf_prompt" | "cf_speech_start" | "cf_speech_end";
export const PHASES = new Set<ProbePhase>(["prompt", "speech_start", "speech_end", "cf_prompt", "cf_speech_start", "cf_speech_end"]);

const FILE = fixturePath("probes.json");
const TIMING_JSONL = fixturePath("probe_timing.jsonl");

export async function createProbe(p: Pick<ProbeRecord, "attemptId" | "itemId" | "quizId" | "confidenceBefore" | "mode">) {
  const probe: ProbeRecord = { id: `prb_${randomUUID().slice(0, 12)}`, createdAt: new Date().toISOString(), ...p };
  await updateJson<ProbeRecord[]>(FILE, [], (all) => [...all, probe]);
  return probe;
}

export async function getProbe(id: string) {
  return (await readJson<ProbeRecord[]>(FILE, [])).find((p) => p.id === id) ?? null;
}

export async function listProbes(filter: { attemptId?: string } = {}) {
  const all = await readJson<ProbeRecord[]>(FILE, []);
  return filter.attemptId ? all.filter((p) => p.attemptId === filter.attemptId) : all;
}

export async function patchProbe(id: string, patch: Partial<ProbeRecord>) {
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

function describeAnswer(item: Item, answer: string | string[] | undefined) {
  if (answer === undefined) return "(no answer recorded)";
  const ids = Array.isArray(answer) ? answer : [answer];
  if (!item.choices) return String(answer);
  return ids.map((id) => `${id}) ${item.choices!.find((c) => c.id === id)?.text ?? "?"}`).join("; ");
}

// The opening prompt quotes the student's own answer back, without saying whether it was right.
export function openingPrompt(item: Item, answer: string | string[] | undefined) {
  return `You answered ${describeAnswer(item, answer)}. Walk me through how you got there, as if you were explaining it to a friend.`;
}

// A counterfactual follow-up (4.4): perturb one thing so the answer follows from the same causal model.
export async function counterfactualFor(item: Item, answer: string | string[] | undefined, explanation: string) {
  const fallback = {
    prompt: "Good. Now suppose one number in the problem changed, say it doubled. What would happen to your answer, and why?",
    source: "template" as const,
  };
  if (!geminiAvailable()) return fallback;
  const prompt = [
    "You write ONE spoken follow-up question for a short think-aloud check in an intro course.",
    "Goal: test whether the student holds a working model of the problem, not whether they memorized the answer.",
    "Rules:",
    "- Change exactly one parameter, condition, or assumption of the ORIGINAL question (e.g. the sample size doubles, a value becomes negative, the test becomes one-sided), or ask which step would break.",
    "- The new answer must follow from the same reasoning as the original. Answerable in 20-40 seconds by talking, without a calculator.",
    "- Build on the student's own answer and words where possible. Don't reveal whether their answer was right. Don't include the answer.",
    "- Warm, plain, one or two sentences, under 40 words. No preamble like 'Great job'.",
    "",
    `Learning objective: ${item.objective || "(not given)"}`,
    `Original question: ${item.stem}`,
    item.choices ? `Choices: ${item.choices.map((c) => `${c.id}) ${c.text}`).join(" | ")}` : "",
    `Answer key (for your reasoning only, never reveal): ${Array.isArray(item.answerKey) ? item.answerKey.join(",") : item.answerKey}`,
    `Student's answer: ${describeAnswer(item, answer)}`,
    `Student's explanation: ${explanation.trim().slice(0, 2000) || "(none)"}`,
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const out = await geminiJson<{ question: string; changed: string }>(prompt, {
      type: "object",
      properties: { question: { type: "string" }, changed: { type: "string", description: "what was perturbed" } },
      required: ["question", "changed"],
    });
    const q = out.question?.trim();
    if (!q || q.length > 400) return fallback;
    return { prompt: q, source: "gemini" as const };
  } catch (err) {
    console.error("[probe] counterfactual generation failed, using template:", (err as Error).message);
    return fallback;
  }
}
