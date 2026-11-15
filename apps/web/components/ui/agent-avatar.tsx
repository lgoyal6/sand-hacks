"use client";
// One avatar family for every Unprompted agent (owner: D). Siblings of the AI Orb Avatar / Siri Orb:
// the same glossy sphere, but each agent has its own hue (evenly spaced oklch hues at one lightness and
// chroma, so they harmonise), its own inner pattern and its own idle motion. Motion plays only while the
// agent is active, and never under prefers-reduced-motion.
//   <AgentAvatar agent="researcher" state="active" size="sm" />
import * as React from "react";
import { cn } from "@/lib/utils";

export type AgentKey =
  | "supervisor"
  | "tutor"
  | "explain-coach"
  | "researcher"
  | "quiz-checker"
  | "rewriter"
  | "judge-panel"
  | "leak-scout";

type Pattern = "hub" | "eyes" | "waves" | "rings" | "grid" | "facets" | "dots" | "radar";

export interface AgentIdentity {
  key: AgentKey;
  name: string;
  /** What it does, in one short line (agents panel, tooltips). */
  role: string;
  hue: number;
  /** Supervisor is deliberately low-chroma: it routes, it doesn't speak for itself. */
  chroma?: number;
  pattern: Pattern;
}

export const AGENTS: Record<AgentKey, AgentIdentity> = {
  supervisor: { key: "supervisor", name: "Supervisor", role: "routes your message to the right helper", hue: 255, chroma: 0.03, pattern: "hub" },
  tutor: { key: "tutor", name: "Tutor", role: "teaches and asks the questions", hue: 255, pattern: "eyes" },
  "explain-coach": { key: "explain-coach", name: "Explain coach", role: "listens to your reasoning", hue: 195, pattern: "waves" },
  researcher: { key: "researcher", name: "Researcher", role: "finds sources and examples", hue: 290, pattern: "rings" },
  "quiz-checker": { key: "quiz-checker", name: "Quiz checker", role: "tests questions against agents", hue: 150, pattern: "grid" },
  rewriter: { key: "rewriter", name: "Rewriter", role: "writes question variants", hue: 75, pattern: "facets" },
  "judge-panel": { key: "judge-panel", name: "Judge panel", role: "three models score explanations", hue: 330, pattern: "dots" },
  "leak-scout": { key: "leak-scout", name: "Leak scout", role: "watches the web for leaked questions", hue: 40, pattern: "radar" },
};

/** Accepts a key, a display name ("Explain coach") or a loose id ("explain_coach", "QuizChecker"). */
export function resolveAgent(nameOrKey: string | undefined | null): AgentIdentity | null {
  if (!nameOrKey) return null;
  const k = nameOrKey
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z-]/g, "");
  if (k in AGENTS) return AGENTS[k as AgentKey];
  const aliases: Record<string, AgentKey> = {
    coach: "explain-coach",
    grader: "judge-panel",
    judge: "judge-panel",
    council: "judge-panel",
    checker: "quiz-checker",
    "attack-agents": "quiz-checker",
    "red-team": "quiz-checker",
    transformer: "rewriter",
    scout: "leak-scout",
    "leak-watch": "leak-scout",
    router: "supervisor",
  };
  return aliases[k] ? AGENTS[aliases[k]] : null;
}

/** oklch colors for an agent: light (highlight), base, deep (rim), and a soft tint for backgrounds. */
export function agentColors(a: AgentIdentity) {
  const c = a.chroma ?? 0.14;
  return {
    light: `oklch(0.93 ${c * 0.45} ${a.hue})`,
    base: `oklch(0.72 ${c} ${a.hue})`,
    deep: `oklch(0.5 ${c * 1.1} ${a.hue})`,
    soft: `oklch(0.96 ${c * 0.25} ${a.hue})`,
    ink: `oklch(0.42 ${c} ${a.hue})`,
  };
}

const SIZES = { xs: 16, sm: 22, md: 32, lg: 48, xl: 72 } as const;

export interface AgentAvatarProps {
  agent: AgentKey | string;
  /** "active" plays this agent's idle motion; "idle" is static; "muted" is static and desaturated. */
  state?: "active" | "idle" | "muted";
  size?: keyof typeof SIZES | number;
  className?: string;
  title?: string;
}

const CSS = `
[data-slot="agent-avatar"] .aa-anim{transform-box:fill-box;transform-origin:center}
[data-slot="agent-avatar"][data-state="muted"]{filter:saturate(.35);opacity:.75}
[data-slot="agent-avatar"][data-state="active"] .aa-blink{animation:aa-blink 3.6s ease-in-out infinite}
[data-slot="agent-avatar"][data-state="active"] .aa-wave{animation:aa-wave 2.4s ease-in-out infinite}
[data-slot="agent-avatar"][data-state="active"] .aa-ring{animation:aa-ring 2.6s ease-out infinite}
[data-slot="agent-avatar"][data-state="active"] .aa-ring2{animation:aa-ring 2.6s ease-out 1.3s infinite}
[data-slot="agent-avatar"][data-state="active"] .aa-scan{animation:aa-scan 1.8s linear infinite}
[data-slot="agent-avatar"][data-state="active"] .aa-spin{animation:aa-spin 9s linear infinite}
[data-slot="agent-avatar"][data-state="active"] .aa-dot1{animation:aa-turn 1.8s ease-in-out infinite}
[data-slot="agent-avatar"][data-state="active"] .aa-dot2{animation:aa-turn 1.8s ease-in-out .6s infinite}
[data-slot="agent-avatar"][data-state="active"] .aa-dot3{animation:aa-turn 1.8s ease-in-out 1.2s infinite}
[data-slot="agent-avatar"][data-state="active"] .aa-sweep{animation:aa-spin 2.4s linear infinite}
[data-slot="agent-avatar"][data-state="active"] .aa-breathe{animation:aa-breathe 3s ease-in-out infinite}
[data-slot="agent-avatar"][data-state="active"] .aa-body{animation:aa-glow 2.4s ease-in-out infinite}
@keyframes aa-blink{0%,88%,100%{transform:scaleY(1)}93%,97%{transform:scaleY(.1)}}
@keyframes aa-wave{0%,100%{transform:translateX(-2px)}50%{transform:translateX(2px)}}
@keyframes aa-ring{0%{transform:scale(.55);opacity:.9}100%{transform:scale(1.25);opacity:0}}
@keyframes aa-scan{0%{transform:translateY(-12px)}100%{transform:translateY(12px)}}
@keyframes aa-spin{to{transform:rotate(360deg)}}
@keyframes aa-turn{0%,100%{opacity:.45;transform:scale(1)}30%{opacity:1;transform:scale(1.35)}}
@keyframes aa-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
@keyframes aa-glow{0%,100%{opacity:1}50%{opacity:.88}}
@media (prefers-reduced-motion:reduce){[data-slot="agent-avatar"] *{animation:none!important}}
`;

function PatternLayer({ pattern }: { pattern: Pattern }) {
  const w = "white";
  switch (pattern) {
    case "eyes":
      return (
        <g className="aa-anim aa-blink">
          <rect x="15" y="15.5" width="3" height="6" rx="1.5" fill={w} />
          <rect x="22" y="15.5" width="3" height="6" rx="1.5" fill={w} />
        </g>
      );
    case "waves":
      return (
        <g className="aa-anim aa-wave" fill="none" stroke={w} strokeWidth="1.6" strokeLinecap="round">
          <path d="M8 17c3-3 5 3 8 0s5 3 8 0 5 3 8 0" opacity=".95" />
          <path d="M8 22c3-3 5 3 8 0s5 3 8 0 5 3 8 0" opacity=".7" />
          <path d="M8 27c3-3 5 3 8 0s5 3 8 0 5 3 8 0" opacity=".45" />
        </g>
      );
    case "rings":
      return (
        <g fill="none" stroke={w}>
          <circle cx="20" cy="20" r="3" fill={w} stroke="none" />
          <circle className="aa-anim aa-ring" cx="20" cy="20" r="8" strokeWidth="1.4" opacity=".85" />
          <circle className="aa-anim aa-ring2" cx="20" cy="20" r="8" strokeWidth="1.4" opacity=".85" />
          <circle cx="20" cy="20" r="12" strokeWidth="1" opacity=".35" />
        </g>
      );
    case "grid":
      return (
        <g>
          <g fill="none" stroke={w} strokeWidth="1" opacity=".55">
            {[13, 20, 27].map((v) => (
              <React.Fragment key={v}>
                <line x1={v} y1="8" x2={v} y2="32" />
                <line x1="8" y1={v} x2="32" y2={v} />
              </React.Fragment>
            ))}
          </g>
          <rect className="aa-anim aa-scan" x="6" y="19" width="28" height="2" rx="1" fill={w} opacity=".95" />
        </g>
      );
    case "facets":
      return (
        <g className="aa-anim aa-spin" fill={w}>
          <path d="M20 9l4.5 7.8H15.5z" opacity=".95" />
          <path d="M29.5 24.5L20 31l-1-9z" opacity=".6" />
          <path d="M10.5 24.5l8.5-2.5-1 9z" opacity=".75" />
        </g>
      );
    case "dots":
      return (
        <g fill={w}>
          <circle className="aa-anim aa-dot1" cx="13" cy="21" r="2.6" />
          <circle className="aa-anim aa-dot2" cx="20" cy="21" r="2.6" />
          <circle className="aa-anim aa-dot3" cx="27" cy="21" r="2.6" />
        </g>
      );
    case "radar":
      return (
        <g>
          <g fill="none" stroke={w} strokeWidth="1" opacity=".5">
            <circle cx="20" cy="20" r="6" />
            <circle cx="20" cy="20" r="11" />
          </g>
          <g className="aa-anim aa-sweep">
            <path d="M20 20L20 7A13 13 0 0 1 31 13.5Z" fill={w} opacity=".55" />
            <line x1="20" y1="20" x2="20" y2="7" stroke={w} strokeWidth="1.6" strokeLinecap="round" />
          </g>
          <circle cx="26" cy="24" r="1.6" fill={w} />
        </g>
      );
    case "hub":
    default:
      return (
        <g className="aa-anim aa-breathe" stroke={w} strokeWidth="1.4" strokeLinecap="round" fill={w}>
          {[0, 60, 120, 180, 240, 300].map((deg) => {
            const r = (deg * Math.PI) / 180;
            return <line key={deg} x1="20" y1="20" x2={20 + 9 * Math.cos(r)} y2={20 + 9 * Math.sin(r)} opacity=".7" />;
          })}
          <circle cx="20" cy="20" r="3.4" stroke="none" />
        </g>
      );
  }
}

export function AgentAvatar({ agent, state = "idle", size = "sm", className, title }: AgentAvatarProps) {
  const id = React.useId().replace(/:/g, "");
  const a = resolveAgent(agent) ?? AGENTS.supervisor;
  const col = agentColors(a);
  const px = typeof size === "number" ? size : SIZES[size];
  return (
    <>
      <style href="unprompted-agent-avatar" precedence="default">
        {CSS}
      </style>
      <svg
        data-slot="agent-avatar"
        data-agent={a.key}
        data-state={state}
        width={px}
        height={px}
        viewBox="0 0 40 40"
        role="img"
        aria-label={title ?? a.name}
        className={cn("shrink-0", className)}
      >
        <title>{title ?? a.name}</title>
        <defs>
          <radialGradient id={`${id}-b`} cx="0.35" cy="0.3" r="0.85">
            <stop offset="0" stopColor={col.light} />
            <stop offset="0.55" stopColor={col.base} />
            <stop offset="1" stopColor={col.deep} />
          </radialGradient>
          <radialGradient id={`${id}-s`} cx="0.32" cy="0.22" r="0.5">
            <stop offset="0" stopColor="white" stopOpacity=".7" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <clipPath id={`${id}-c`}>
            <circle cx="20" cy="20" r="19" />
          </clipPath>
        </defs>
        <circle className="aa-anim aa-body" cx="20" cy="20" r="19" fill={`url(#${id}-b)`} />
        <g clipPath={`url(#${id}-c)`}>
          <PatternLayer pattern={a.pattern} />
          <circle cx="20" cy="20" r="19" fill={`url(#${id}-s)`} />
        </g>
        <circle cx="20" cy="20" r="18.5" fill="none" stroke={col.deep} strokeOpacity=".25" />
      </svg>
    </>
  );
}

/** Siri Orb colors for an agent, so the composer orb takes the speaking agent's hue. */
export function agentOrbColors(agent: string | undefined | null) {
  const a = resolveAgent(agent);
  if (!a) return undefined;
  const c = a.chroma ?? 0.14;
  return {
    bg: "var(--background)",
    c1: `oklch(0.68 ${c} ${a.hue})`,
    c2: `oklch(0.8 ${c * 0.8} ${(a.hue + 25) % 360})`,
    c3: `oklch(0.75 ${c * 0.7} ${(a.hue + 335) % 360})`,
  };
}
