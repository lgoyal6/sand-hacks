"use client";
// Agent-status events for D's AgentPanel. Plain browser events, so any component can listen:
//   window.addEventListener("unprompted:agent-status", (e) => (e as CustomEvent<AgentStatus>).detail)
// These describe what Unprompted's own helpers are doing for the student (never anything about detection).

export type AgentName = "Tutor" | "Explain coach" | "Grader";
export interface AgentStatus {
  agent: AgentName;
  status: string;
  state: "working" | "idle" | "done";
  at: string;
}

export const AGENT_STATUS_EVENT = "unprompted:agent-status";

export function emitAgentStatus(agent: AgentName, status: string, state: AgentStatus["state"] = "working") {
  if (typeof window === "undefined") return;
  const detail: AgentStatus = { agent, status, state, at: new Date().toISOString() };
  window.dispatchEvent(new CustomEvent<AgentStatus>(AGENT_STATUS_EVENT, { detail }));
}
