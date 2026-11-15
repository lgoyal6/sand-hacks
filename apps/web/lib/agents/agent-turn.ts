"use client";
// Client for B's agent API: POST /api/agents/<agent>/turn streams NDJSON lines of
//   AgentEvent {agentId, status, label, toolCall?, ts}  -> forwarded to D's Agents panel
//   {type:"delta", agent, text}                          -> streamed reply text
//   {type:"message", agent, text, servedBy}              -> final reply
//   {type:"error", agent, message}
// Mode and quiz come from the attempt on the server, never from the browser.
import type { AgentEvent } from "@unprompted/shared";
import { AGENT_STATUS_EVENT } from "@/lib/telemetry/agent-status";

export interface TurnHistory {
  role: "user" | "assistant";
  content: string;
}

export async function agentTurn(
  agent: "tutor" | "researcher" | "explain-coach",
  body: { attemptId: string | null; input: string; history?: TurnHistory[] },
  onDelta: (textSoFar: string) => void,
): Promise<{ text: string; servedBy?: string; error?: string }> {
  let text = "";
  let final: { text: string; servedBy?: string; error?: string } | null = null;
  const res = await fetch(`/api/agents/${agent}/turn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ attemptId: body.attemptId ?? undefined, input: body.input, history: body.history ?? [] }),
  });
  if (!res.ok || !res.body) {
    const msg = ((await res.json().catch(() => ({}))) as { error?: string }).error;
    return { text: "", error: msg ?? `The ${agent} is unavailable right now (${res.status}).` };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const handle = (line: string) => {
    if (!line.trim()) return;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if ("agentId" in m) {
      window.dispatchEvent(new CustomEvent<AgentEvent>(AGENT_STATUS_EVENT, { detail: m as unknown as AgentEvent }));
    } else if (m.type === "delta") {
      text += String(m.text ?? "");
      onDelta(text);
    } else if (m.type === "message") {
      final = { text: String(m.text ?? text), servedBy: m.servedBy as string | undefined };
    } else if (m.type === "error") {
      final = { text, error: String(m.message ?? "Something went wrong.") };
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    lines.forEach(handle);
  }
  handle(buf);
  return final ?? { text };
}
