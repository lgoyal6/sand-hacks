"use client";
import { AgentState } from "@/components/ui/agent-state";
import { AGENT_ORDER, AGENT_ROLE, type RunState } from "../_lib/agents";

/** Quiet right-side panel: what each agent is doing right now. */
export function AgentsPanel({ run }: { run: RunState | null }) {
  return (
    <aside className="flex h-full flex-col gap-4 border-l bg-background px-4 py-5" aria-label="Agents">
      <div>
        <h2 className="text-sm font-semibold">Agents</h2>
        <p className="text-xs text-muted-foreground">
          {run?.running ? (run.mode === "replay" ? "Replaying a recorded run" : "Working on your quiz") : "Idle"}
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {AGENT_ORDER.map((name) => {
          const row = run?.agents[name];
          return (
            <li key={name} className="rounded-lg border px-3 py-2">
              <AgentState
                size="sm"
                status={row?.status ?? "idle"}
                tone={row && row.status !== "idle" ? "default" : "muted"}
                label={name}
                description={row && row.activity !== "Waiting" ? row.activity : AGENT_ROLE[name]}
              />
            </li>
          );
        })}
      </ul>
      {run?.errors.length ? (
        <div className="mt-auto rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">System notes</p>
          {run.errors.slice(-3).map((e, i) => (
            <p key={i} className="mt-1 break-words">
              {e.slice(0, 220)}
            </p>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
