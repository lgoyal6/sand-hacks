"use client";
// Right-hand "Agents" panel: quiet rows (name, one-line status, small state mark). Only the active agent
// animates; the rest are static and muted. A row expands to a short step log.
import * as React from "react";
import { ChevronRight, PanelRightClose } from "lucide-react";
import { type AgentStatus } from "@/components/ui/agent-state";
import { AgentAvatar, resolveAgent } from "@/components/ui/agent-avatar";
import { cn } from "@/lib/utils";

export interface AgentStep {
  text: string;
  /** Short time label, e.g. "now", "12s". */
  at?: string;
  done?: boolean;
}

export interface AgentInfo {
  id: string;
  name: string;
  /** One line, present tense: "tested 5 questions", "preparing a follow-up". */
  status: string;
  state: AgentStatus;
  steps?: AgentStep[];
}

/** C's browser event: window.dispatchEvent(new CustomEvent("unprompted:agent-status", { detail })). */
export interface AgentStatusEventDetail {
  agent: string;
  status: string;
  state: "working" | "idle" | "done" | "thinking" | "needs-input" | "error";
  at?: string;
}

const EVENT_STATE: Record<AgentStatusEventDetail["state"], AgentStatus> = {
  working: "working",
  thinking: "thinking",
  idle: "idle",
  done: "complete",
  "needs-input": "needs-input",
  error: "error",
};

function timeLabel(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Merge live "unprompted:agent-status" events into a base agent list (matched by name, new names appended). */
export function useAgentStatusEvents(base: AgentInfo[]): AgentInfo[] {
  // Only the live overrides live in state; the merge with `base` happens during render.
  const [live, setLive] = React.useState<Record<string, AgentInfo>>({});
  React.useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<AgentStatusEventDetail>).detail;
      if (!d?.agent) return;
      const state = EVENT_STATE[d.state] ?? "idle";
      const step = { text: d.status, at: timeLabel(d.at), done: state !== "working" && state !== "thinking" };
      setLive((cur) => {
        const prev = cur[d.agent];
        const steps = [...(prev?.steps ?? []).map((s) => ({ ...s, done: true })), step].slice(-8);
        return { ...cur, [d.agent]: { id: d.agent, name: d.agent, status: d.status, state, steps } };
      });
    };
    window.addEventListener("unprompted:agent-status", on);
    return () => window.removeEventListener("unprompted:agent-status", on);
  }, []);
  return React.useMemo(() => {
    const names = new Set(base.map((a) => a.name));
    const merged = base.map((a) => (live[a.name] ? { ...a, ...live[a.name], id: a.id, steps: [...(a.steps ?? []), ...(live[a.name].steps ?? [])].slice(-8) } : a));
    return [...merged, ...Object.values(live).filter((a) => !names.has(a.name))];
  }, [base, live]);
}

export interface AgentPanelProps {
  agents: AgentInfo[];
  /** The one agent allowed to animate. Defaults to the first agent that is thinking or working. */
  activeId?: string;
  title?: string;
  onClose?: () => void;
  /** Listen for "unprompted:agent-status" window events (default true). */
  listen?: boolean;
  className?: string;
}

function StaticMark({ state }: { state: AgentStatus }) {
  const color: Record<AgentStatus, string> = {
    idle: "bg-muted-foreground/30",
    thinking: "bg-brand/60",
    working: "bg-brand/60",
    "needs-input": "bg-gap",
    complete: "bg-verified",
    error: "bg-destructive",
  };
  return <span aria-hidden className={cn("size-2 rounded-full", color[state])} />;
}

export function AgentPanel({ agents: base, activeId, title = "Agents", onClose, listen = true, className }: AgentPanelProps) {
  const live = useAgentStatusEvents(base);
  const agents = listen ? live : base;
  const active = activeId ?? agents.find((a) => a.state === "thinking" || a.state === "working")?.id;
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <aside aria-label={title} className={cn("flex h-svh w-[300px] shrink-0 flex-col border-l border-border bg-background", className)}>
      <div className="flex h-14 items-center justify-between px-4">
        <p className="text-sm font-medium">{title}</p>
        {onClose && (
          <button
            type="button"
            aria-label="Hide agents"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PanelRightClose className="size-4" />
          </button>
        )}
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {agents.map((a) => {
          const isActive = a.id === active;
          const expanded = open === a.id;
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : a.id)}
                aria-expanded={expanded}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted",
                  expanded && "bg-muted",
                )}
              >
                <span className="relative grid size-7 shrink-0 place-items-center">
                  {resolveAgent(a.name) || resolveAgent(a.id) ? (
                    <AgentAvatar agent={resolveAgent(a.id) ? a.id : a.name} size={26} state={isActive ? "active" : a.state === "idle" ? "muted" : "idle"} />
                  ) : (
                    <StaticMark state={a.state} />
                  )}
                  {(a.state === "needs-input" || a.state === "error") && (
                    <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-background" style={{ background: a.state === "error" ? "var(--destructive)" : "var(--gap)" }} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm", isActive ? "font-medium text-foreground" : "text-foreground/80")}>{a.name}</span>
                  <span className={cn("block truncate text-xs", isActive ? "text-brand" : "text-muted-foreground")}>{a.status}</span>
                </span>
                {a.steps?.length ? (
                  <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
                ) : null}
              </button>
              {expanded && a.steps?.length ? (
                <ol className="mb-2 ml-[2.6rem] mr-2 mt-1 space-y-1.5 border-l border-border pl-3">
                  {a.steps.map((s, i) => (
                    <li key={i} className="flex gap-2 text-xs">
                      <span className={cn("flex-1", s.done === false ? "text-foreground" : "text-muted-foreground")}>{s.text}</span>
                      {s.at && <span className="num shrink-0 text-muted-foreground/70">{s.at}</span>}
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
