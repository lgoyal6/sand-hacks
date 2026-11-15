"use client";
// Agent avatar family gallery (owner: D). Reference for everyone: hue, pattern, motion per agent.
import * as React from "react";
import Link from "next/link";
import { AGENTS, AgentAvatar, agentColors, type AgentKey } from "@/components/ui/agent-avatar";
import { VoiceOrb } from "@/components/ui/siri-orb";
import { agentOrbColors } from "@/components/ui/agent-avatar";

const PATTERN_NOTE: Record<string, string> = {
  hub: "round eyes · hub texture",
  sheen: "soft oval eyes · plain sheen",
  waves: "smiling arc eyes · sound waves",
  rings: "curious eyes · ripples",
  grid: "focused pill eyes · scan grid",
  facets: "tilted eyes · facets",
  dots: "half-lidded eyes · three judges",
  radar: "squinting eyes · radar sweep",
};
const STATES = ["idle", "active", "thinking", "speaking", "muted"] as const;

export default function Page() {
  const [active, setActive] = React.useState<AgentKey | "all" | "none">("all");
  const [cardState, setCardState] = React.useState<(typeof STATES)[number]>("active");
  const keys = Object.keys(AGENTS) as AgentKey[];
  return (
    <main className="mx-auto max-w-5xl px-8 py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Agent family</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            One sphere with eyes, eight siblings: each agent has its own hue, texture and eye style. Eyes react to state; at 24px and below they simplify to two dots.
          </p>
        </div>
        <Link href="/professor/design" className="text-sm text-brand hover:underline">
          Chat reference
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 text-sm">
        {STATES.map((s) => (
          <button
            key={s}
            onClick={() => {
              setCardState(s);
              setActive("all");
            }}
            className={`h-8 rounded-full border px-3 ${cardState === s ? "border-foreground/70 bg-muted" : "border-border hover:bg-muted"}`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {keys.map((k) => {
          const a = AGENTS[k];
          const on = active === "all" || active === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setActive(active === k ? "none" : k)}
              className="flex flex-col items-center gap-3 rounded-2xl border border-border p-5 text-center transition-colors hover:bg-muted/50"
              style={{ background: on ? agentColors(a).soft : undefined }}
            >
              <AgentAvatar agent={k} size="xl" state={on ? cardState : "idle"} />
              <div>
                <p className="text-[15px] font-medium">{a.name}</p>
                <p className="text-xs text-muted-foreground">{a.role}</p>
                <p className="mt-1 text-[11px] text-muted-foreground/80">{PATTERN_NOTE[a.pattern]}</p>
              </div>
            </button>
          );
        })}
      </div>

      <h2 className="mt-10 text-lg font-semibold">Sizes and states</h2>
      <div className="mt-3 space-y-3 rounded-2xl border border-border p-5">
        {STATES.map((s) => (
          <div key={s} className="flex items-center gap-4">
            <span className="w-14 text-xs text-muted-foreground">{s}</span>
            {keys.map((k) => (
              <span key={k} className="flex items-center gap-2">
                <AgentAvatar agent={k} size="xs" state={s} />
                <AgentAvatar agent={k} size="sm" state={s} />
              </span>
            ))}
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-lg font-semibold">Composer orb takes the speaker&apos;s hue</h2>
      <div className="mt-3 flex flex-wrap items-end gap-8 rounded-2xl border border-border p-6">
        {(["tutor", "explain-coach", "researcher", "judge-panel"] as AgentKey[]).map((k) => (
          <div key={k} className="flex flex-col items-center gap-1">
            <VoiceOrb state="speaking" size="72px" colors={agentOrbColors(k)} />
            <span className="text-xs text-muted-foreground">{AGENTS[k].name}</span>
          </div>
        ))}
      </div>
    </main>
  );
}
