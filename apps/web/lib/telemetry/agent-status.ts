"use client";
// Agent activity events for D's AgentPanel, in the shared AgentEvent shape (packages/shared):
//   window.addEventListener("unprompted:agent-status", (e) => (e as CustomEvent<AgentEvent>).detail)
// These describe what Unprompted's helpers are doing for the student (never anything about detection).
import type { AgentEvent, AgentEventStatus, AgentId, AgentEvent as _Shape } from "@unprompted/shared";

export const AGENT_STATUS_EVENT = "unprompted:agent-status";
export type { AgentEvent, AgentId };

const STATE: Record<"working" | "idle" | "done" | "thinking" | "needs-input" | "error", AgentEventStatus> = {
  working: "running",
  thinking: "thinking",
  idle: "idle",
  done: "done",
  "needs-input": "needs-input",
  error: "error",
};

export function emitAgentStatus(agentId: AgentId, label: string, state: keyof typeof STATE = "working", toolCall?: _Shape["toolCall"]) {
  if (typeof window === "undefined") return;
  const detail: AgentEvent = { agentId, status: STATE[state], label, toolCall, ts: new Date().toISOString() };
  window.dispatchEvent(new CustomEvent<AgentEvent>(AGENT_STATUS_EVENT, { detail }));
}
