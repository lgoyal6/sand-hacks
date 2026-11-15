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

// Privacy (build plan 7): audio is deleted after grading. Deleting the conversation removes audio and transcript
// at ElevenLabs; our copy of the transcript stays in probes.json for the appeal window.
export async function deleteConversation(id: string) {
  const res = await fetch(`${API}/convai/conversations/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "xi-api-key": key() } });
  return res.ok;
}

export function formatTranscript(turns: TranscriptTurn[]) {
  return turns
    .filter((t) => t.message && t.message.trim())
    .map((t) => `[${t.time_in_call_secs.toFixed(0).padStart(3, " ")}s] ${t.role === "agent" ? "Unprompted" : "Student (voice)"}: ${t.message!.trim()}`)
    .join("\n");
}
