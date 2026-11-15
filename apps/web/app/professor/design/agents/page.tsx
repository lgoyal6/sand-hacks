"use client";
// Agent avatar family gallery (owner: D). Reference for everyone: hue, pattern, motion per agent.
import * as React from "react";
import Link from "next/link";
import { AGENTS, AgentAvatar, agentColors, type AgentKey } from "@/components/ui/agent-avatar";
import { VoiceOrb } from "@/components/ui/siri-orb";
import { agentOrbColors } from "@/components/ui/agent-avatar";

const PATTERN_NOTE: Record<string, string> = {
  hub: "hub and spokes · breathes",
  eyes: "eyes · blinks",
  waves: "sound waves · drift",
  rings: "ripples · pulse outward",
  grid: "grid · scan line",
  facets: "facets · slow turn",
  dots: "three judges · take turns",
  radar: "radar · sweep",
};

export default function Page() {
  const [active, setActive] = React.useState<AgentKey | "all" | "none">("all");
  const keys = Object.keys(AGENTS) as AgentKey[];
  return (
    <main className="mx-auto max-w-5xl px-8 py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Agent family</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            One sphere, eight siblings: each agent has its own hue, inner pattern and idle motion. Motion plays only while that agent is active.
          </p>
        </div>
        <Link href="/professor/design" className="text-sm text-brand hover:underline">
          Chat reference
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 text-sm">
        {(["all", "none"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setActive(v)}
            className={`h-8 rounded-full border px-3 ${active === v ? "border-foreground/70 bg-muted" : "border-border hover:bg-muted"}`}
          >
            {v === "all" ? "All active" : "All idle"}
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
              <AgentAvatar agent={k} size="xl" state={on ? "active" : "idle"} />
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
        {(["active", "idle", "muted"] as const).map((s) => (
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
