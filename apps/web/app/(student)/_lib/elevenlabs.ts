// ElevenLabs Agents (server only). The API key never reaches the browser: the browser gets a
// short-lived signed URL for the private agent (platform auth is enabled on the agent).
import "server-only";

const API = "https://api.elevenlabs.io/v1";

function key() {
  const k = process.env.ELEVENLABS_API_KEY?.trim();
  if (!k) throw new Error("ELEVENLABS_API_KEY missing");
  return k;
}

export function voiceConfigured() {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim() && process.env.ELEVENLABS_AGENT_ID?.trim());
}

export async function signedUrl(): Promise<string> {
  const agent = process.env.ELEVENLABS_AGENT_ID!.trim();
  const res = await fetch(`${API}/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agent)}`, { headers: { "xi-api-key": key() }, cache: "no-store" });
  if (!res.ok) throw new Error(`signed url ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { signed_url: string }).signed_url;
}

export interface TranscriptTurn {
  role: "agent" | "user";
  message: string | null;
  time_in_call_secs: number;
  tool_calls?: { tool_name?: string; params_as_json?: string }[];
}

export interface Conversation {
  conversation_id: string;
  agent_id: string;
  status: "initiated" | "in-progress" | "processing" | "done" | "failed";
  transcript: TranscriptTurn[];
  metadata?: { call_duration_secs?: number; start_time_unix_secs?: number };
}

// The transcript is finalized shortly after the call ends, so poll briefly until status is done.
export async function getConversation(id: string, waitMs = 12000): Promise<Conversation> {
  const deadline = Date.now() + waitMs;
  let last: Conversation | null = null;
  while (true) {
    const res = await fetch(`${API}/convai/conversations/${encodeURIComponent(id)}`, { headers: { "xi-api-key": key() }, cache: "no-store" });
    if (res.ok) {
      last = (await res.json()) as Conversation;
      if (last.agent_id !== process.env.ELEVENLABS_AGENT_ID?.trim()) throw new Error("conversation belongs to another agent");
      if (last.status === "done" || last.status === "failed") return last;
    }
    if (Date.now() > deadline) {
      if (last) return last;
      throw new Error(`conversation ${id} not available (${res.status})`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// Privacy (build plan 7): the call is deleted once our transcript is saved (lib/retention.ts). Deleting the
// conversation removes audio and transcript at ElevenLabs; our transcript stays until the professor deletes it.
// A 404 means it is already gone, which counts as deleted.
export async function deleteConversation(id: string) {
  const res = await fetch(`${API}/convai/conversations/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "xi-api-key": key() } });
  return res.ok || res.status === 404;
}

export function formatTranscript(turns: TranscriptTurn[]) {
  return turns
    .filter((t) => t.message && t.message.trim())
    .map((t) => ({ ...t, message: t.message!.replace(/\[[a-z ]{2,20}\]\s*/gi, "").trim() }))
    .filter((t) => t.message)
    .map((t) => `[${t.time_in_call_secs.toFixed(0).padStart(3, " ")}s] ${t.role === "agent" ? "Unprompted" : "Student (voice)"}: ${t.message}`)
    .join("\n");
}

// ---------- Scribe word timestamps (precise counterfactual latency) ----------
export interface ScribeWord {
  text: string;
  start: number; // seconds into the call
  end: number;
  speaker_id?: string;
}

/** Transcribes the call recording with Scribe (word timestamps + diarization). Null if unavailable. */
export async function scribeCall(conversationId: string): Promise<ScribeWord[] | null> {
  const audio = await fetch(`${API}/convai/conversations/${encodeURIComponent(conversationId)}/audio`, { headers: { "xi-api-key": key() }, cache: "no-store" });
  if (!audio.ok) return null;
  const blob = new Blob([await audio.arrayBuffer()], { type: "audio/mpeg" });
  for (const model of ["scribe_v2", "scribe_v1"]) {
    const fd = new FormData();
    fd.append("model_id", model);
    fd.append("file", blob, "call.mp3");
    fd.append("timestamps_granularity", "word");
    fd.append("diarize", "true");
    const r = await fetch(`${API}/speech-to-text`, { method: "POST", headers: { "xi-api-key": key() }, body: fd });
    if (!r.ok) continue;
    const words = ((await r.json()) as { words?: (ScribeWord & { type?: string })[] }).words ?? [];
    return words.filter((w) => (w.type ?? "word") === "word" && typeof w.start === "number");
  }
  return null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);

/**
 * Counterfactual latency from word timestamps: end of the agent's last word of the follow-up question
 * -> start of the student's first word after it. The question is located by its closing words (spoken
 * numbers can differ from the written text, so we match the tail), falling back to diarized turns
 * around the follow-up's time in the call.
 */
export function cfLatencyFromWords(words: ScribeWord[], cfPrompt: string, cfTurnSecs?: number) {
  const toks = words.map((w) => norm(w.text).join(" "));
  const tail = norm(cfPrompt).slice(-3);
  let endIdx = -1;
  if (tail.length === 3) {
    for (let i = 2; i < toks.length; i++) {
      if (toks[i - 2] === tail[0] && toks[i - 1] === tail[1] && toks[i] === tail[2]) endIdx = i; // last match wins
    }
  }
  if (endIdx < 0 && cfTurnSecs !== undefined && words.some((w) => w.speaker_id)) {
    // Fallback: the agent's diarized segment that starts nearest the follow-up turn.
    const startIdx = words.reduce((best, w, i) => (Math.abs(w.start - cfTurnSecs) < Math.abs(words[best].start - cfTurnSecs) ? i : best), 0);
    const spk = words[startIdx].speaker_id;
    endIdx = startIdx;
    while (endIdx + 1 < words.length && words[endIdx + 1].speaker_id === spk) endIdx++;
  }
  if (endIdx < 0 || endIdx + 1 >= words.length) return null;
  const agentSpk = words[endIdx].speaker_id;
  const next = words.slice(endIdx + 1).find((w) => !agentSpk || w.speaker_id !== agentSpk) ?? words[endIdx + 1];
  const latencyMs = Math.round((next.start - words[endIdx].end) * 1000);
  if (latencyMs < 0 || latencyMs > 30000) return null;
  return { cfEndSec: words[endIdx].end, answerStartSec: next.start, latencyMs };
}
