"use client";
// One avatar family for every Unprompted agent (owner: D). Siblings of the AI Orb Avatar / Siri Orb:
// the same glossy sphere, but each agent has its own hue (evenly spaced oklch hues at one lightness and
// chroma, so they harmonise), its own inner pattern and its own idle motion. Motion plays only while the
// agent is active, and never under prefers-reduced-motion. Every agent has two eyes (the family trait).
//   <AgentAvatar agent="researcher" state="active" size="sm" />
import * as React from "react";
import { cn } from "@/lib/utils";

export type AgentKey =
  | "supervisor"
  | "tutor"
  | "explain-coach"
  | "researcher"
  | "quiz-checker"
  | "answer-checker"
  | "rewriter"
  | "judge-panel"
  | "leak-scout";

type Pattern = "hub" | "sheen" | "waves" | "rings" | "grid" | "facets" | "dots" | "radar" | "checks";
/** Every agent has two eyes (the family trait); the style varies. */
type EyeStyle = "round" | "oval" | "arc" | "curious" | "pill" | "tilted" | "lidded" | "squint" | "dash";

export interface AgentIdentity {
  key: AgentKey;
  name: string;
  /** What it does, in one short line (agents panel, tooltips). */
  role: string;
  hue: number;
  /** Supervisor is deliberately low-chroma: it routes, it doesn't speak for itself. */
  chroma?: number;
  pattern: Pattern;
  eyes: EyeStyle;
}

export const AGENTS: Record<AgentKey, AgentIdentity> = {
  supervisor: { key: "supervisor", name: "Supervisor", role: "routes your message to the right helper", hue: 255, chroma: 0.03, pattern: "hub", eyes: "round" },
  tutor: { key: "tutor", name: "Tutor", role: "teaches and asks the questions", hue: 255, pattern: "sheen", eyes: "oval" },
  "explain-coach": { key: "explain-coach", name: "Explain coach", role: "listens to your reasoning", hue: 195, pattern: "waves", eyes: "arc" },
  researcher: { key: "researcher", name: "Researcher", role: "finds sources and examples", hue: 290, pattern: "rings", eyes: "curious" },
  "quiz-checker": { key: "quiz-checker", name: "Quiz checker", role: "tests questions against agents", hue: 150, pattern: "grid", eyes: "pill" },
  "answer-checker": { key: "answer-checker", name: "Answer checker", role: "solves each variant 3 times with code", hue: 110, pattern: "checks", eyes: "dash" },
  rewriter: { key: "rewriter", name: "Rewriter", role: "writes question variants", hue: 75, pattern: "facets", eyes: "tilted" },
  "judge-panel": { key: "judge-panel", name: "Judge panel", role: "three models score explanations", hue: 330, pattern: "dots", eyes: "lidded" },
  "leak-scout": { key: "leak-scout", name: "Leak scout", role: "watches the web for leaked questions", hue: 40, pattern: "radar", eyes: "squint" },
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
    solver: "answer-checker",
    verifier: "answer-checker",
    "key-checker": "answer-checker",
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

export type AvatarState = "idle" | "active" | "thinking" | "speaking" | "muted";

const SIZES = { xs: 16, sm: 22, md: 32, lg: 48, xl: 72 } as const;

export interface AgentAvatarProps {
  agent: AgentKey | string;
  /**
   * idle: occasional blink. active: looks toward the content, texture moves. thinking: glances sideways and
   * squints. speaking: eyes open wider with the pulse. muted: still and desaturated (inactive rows).
   */
  state?: AvatarState;
  size?: keyof typeof SIZES | number;
  className?: string;
  title?: string;
}

const CSS = `
[data-slot="agent-avatar"] .aa-anim{transform-box:fill-box;transform-origin:center}
[data-slot="agent-avatar"][data-state="muted"]{filter:saturate(.35);opacity:.75}
[data-slot="agent-avatar"]:is([data-state="active"],[data-state="thinking"],[data-state="speaking"]) .aa-wave{animation:aa-wave 2.4s ease-in-out infinite}
[data-slot="agent-avatar"]:is([data-state="active"],[data-state="thinking"],[data-state="speaking"]) .aa-ring{animation:aa-ring 2.6s ease-out infinite}
[data-slot="agent-avatar"]:is([data-state="active"],[data-state="thinking"],[data-state="speaking"]) .aa-ring2{animation:aa-ring 2.6s ease-out 1.3s infinite}
[data-slot="agent-avatar"]:is([data-state="active"],[data-state="thinking"],[data-state="speaking"]) .aa-scan{animation:aa-scan 1.8s linear infinite}
[data-slot="agent-avatar"]:is([data-state="active"],[data-state="thinking"],[data-state="speaking"]) .aa-spin{animation:aa-spin 9s linear infinite}
[data-slot="agent-avatar"]:is([data-state="active"],[data-state="thinking"],[data-state="speaking"]) .aa-dot1{animation:aa-turn 1.8s ease-in-out infinite}
[data-slot="agent-avatar"]:is([data-state="active"],[data-state="thinking"],[data-state="speaking"]) .aa-dot2{animation:aa-turn 1.8s ease-in-out .6s infinite}
[data-slot="agent-avatar"]:is([data-state="active"],[data-state="thinking"],[data-state="speaking"]) .aa-dot3{animation:aa-turn 1.8s ease-in-out 1.2s infinite}
[data-slot="agent-avatar"]:is([data-state="active"],[data-state="thinking"],[data-state="speaking"]) .aa-sweep{animation:aa-spin 2.4s linear infinite}
[data-slot="agent-avatar"]:is([data-state="active"],[data-state="thinking"],[data-state="speaking"]) .aa-breathe{animation:aa-breathe 3s ease-in-out infinite}
/* Eyes. Each agent's blink cadence comes from --aa-blink. */
[data-slot="agent-avatar"] .aa-eyes{transition:transform .35s ease}
[data-slot="agent-avatar"]:is([data-state="idle"],[data-state="active"]) .aa-lids{animation:aa-blink var(--aa-blink,6s) ease-in-out infinite}
[data-slot="agent-avatar"][data-state="active"] .aa-eyes{transform:translate(1.6px,1.2px)}
[data-slot="agent-avatar"][data-state="thinking"] .aa-eyes{animation:aa-glance 2.8s ease-in-out infinite}
[data-slot="agent-avatar"][data-state="thinking"] .aa-lids{transform:scaleY(.55)}
[data-slot="agent-avatar"][data-state="speaking"] .aa-lids{animation:aa-open 1.1s ease-in-out infinite}
[data-slot="agent-avatar"][data-state="speaking"] .aa-body{animation:aa-pulse 1.1s ease-in-out infinite}
@keyframes aa-blink{0%,92%,100%{transform:scaleY(1)}95%,97%{transform:scaleY(.1)}}
@keyframes aa-glance{0%,100%{transform:translate(0,-.6px)}30%{transform:translate(-2.4px,-1px)}65%{transform:translate(2.4px,-1px)}}
@keyframes aa-open{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.28)}}
@keyframes aa-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.035)}}
@keyframes aa-wave{0%,100%{transform:translateX(-2px)}50%{transform:translateX(2px)}}
@keyframes aa-ring{0%{transform:scale(.55);opacity:.9}100%{transform:scale(1.25);opacity:0}}
@keyframes aa-scan{0%{transform:translateY(-12px)}100%{transform:translateY(12px)}}
@keyframes aa-spin{to{transform:rotate(360deg)}}
@keyframes aa-turn{0%,100%{opacity:.45;transform:scale(1)}30%{opacity:1;transform:scale(1.35)}}
@keyframes aa-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
@media (prefers-reduced-motion:reduce){[data-slot="agent-avatar"] *{animation:none!important;transition:none!important}}
`;

function PatternLayer({ pattern }: { pattern: Pattern }) {
  const w = "white";
  switch (pattern) {
    case "sheen":
      return (
        <g fill={w}>
          <ellipse cx="13" cy="30" rx="9" ry="3" opacity=".35" />
          <ellipse cx="29" cy="9" rx="5" ry="2" opacity=".3" />
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
          <path d="M20 3l4 6h-8z" opacity=".95" />
          <path d="M35 27l-6 6-1.5-7z" opacity=".7" />
          <path d="M5 27l7.5-1-1.5 7z" opacity=".8" />
        </g>
      );
    case "dots":
      return (
        <g fill={w}>
          <circle className="aa-anim aa-dot1" cx="14" cy="29" r="2" />
          <circle className="aa-anim aa-dot2" cx="20" cy="30" r="2" />
          <circle className="aa-anim aa-dot3" cx="26" cy="29" r="2" />
        </g>
      );
    case "checks":
      // Three check marks, one per solve; they light up in turn while the agent works.
      return (
        <g fill="none" stroke={w} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path className="aa-anim aa-dot1" d="M9 28.5l2 2 3.5-4" />
          <path className="aa-anim aa-dot2" d="M17 28.5l2 2 3.5-4" />
          <path className="aa-anim aa-dot3" d="M25 28.5l2 2 3.5-4" />
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
            <path d="M20 20L20 7A13 13 0 0 1 31 13.5Z" fill={w} opacity=".35" />
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
            return <line key={deg} x1="20" y1="20" x2={(20 + 9 * Math.cos(r)).toFixed(2)} y2={(20 + 9 * Math.sin(r)).toFixed(2)} opacity=".7" />;
          })}
          <circle cx="20" cy="20" r="3.4" stroke="none" />
        </g>
      );
  }
}


/** Eye shapes per style, drawn around (cx, cy). `lids` scales vertically for blinks/squints. */
function Eyes({ style, simple }: { style: EyeStyle; simple: boolean }) {
  const w = "white";
  const y = 19;
  const L = 15.5;
  const R = 24.5;
  if (simple) {
    // Tiny sizes: two clear dots, nothing else.
    return (
      <g className="aa-eyes">
        <g className="aa-anim aa-lids">
          <circle cx={L} cy={y} r="2.6" fill={w} />
          <circle cx={R} cy={y} r="2.6" fill={w} />
        </g>
      </g>
    );
  }
  const shape = (cx: number, i: number) => {
    switch (style) {
      case "oval":
        return <rect key={i} x={cx - 1.6} y={y - 3.2} width="3.2" height="6.4" rx="1.6" fill={w} />;
      case "arc":
        return <path key={i} d={`M${cx - 2.6} ${y + 1}q2.6 -3.6 5.2 0`} fill="none" stroke={w} strokeWidth="1.9" strokeLinecap="round" />;
      case "curious":
        return (
          <g key={i}>
            <circle cx={cx} cy={y} r="2.9" fill={w} />
            <circle cx={cx + 0.9} cy={y - 0.9} r="1.2" fill="rgba(0,0,0,.28)" />
          </g>
        );
      case "pill":
        return <rect key={i} x={cx - 1.5} y={y - 3} width="3" height="6" rx="0.9" fill={w} />;
      case "tilted":
        return <ellipse key={i} cx={cx} cy={y} rx="1.8" ry="3.1" fill={w} transform={`rotate(${i ? 14 : -14} ${cx} ${y})`} />;
      case "lidded":
        return <path key={i} d={`M${cx - 2.6} ${y - 0.6}h5.2a2.6 2.6 0 0 1 -5.2 0z`} fill={w} />;
      case "dash":
        // Focused, reading-a-line look: short level bars.
        return <rect key={i} x={cx - 2.4} y={y - 1.1} width="4.8" height="2.2" rx="1.1" fill={w} />;
      case "squint":
        return <ellipse key={i} cx={cx - 0.6} cy={y} rx="2.8" ry="1.6" fill={w} />;
      case "round":
      default:
        return <circle key={i} cx={cx} cy={y} r="2.3" fill={w} />;
    }
  };
  return (
    <g className="aa-eyes">
      <g className="aa-anim aa-lids">{[L, R].map((cx, i) => shape(cx, i))}</g>
    </g>
  );
}

const BLINK: Record<EyeStyle, string> = {
  round: "7s",
  oval: "4.6s",
  arc: "6.2s",
  curious: "3.8s",
  pill: "5.4s",
  tilted: "6.8s",
  lidded: "8.5s",
  squint: "5s",
  dash: "7.6s",
};

export function AgentAvatar({ agent, state = "idle", size = "sm", className, title }: AgentAvatarProps) {
  const id = React.useId().replace(/:/g, "");
  const a = resolveAgent(agent) ?? AGENTS.supervisor;
  const col = agentColors(a);
  const px = typeof size === "number" ? size : SIZES[size];
  const simple = px <= 24;
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
        style={{ ["--aa-blink" as string]: BLINK[a.eyes] }}
      >
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
          {!simple && (
            <g opacity=".28">
              <PatternLayer pattern={a.pattern} />
            </g>
          )}
          <circle cx="20" cy="20" r="19" fill={`url(#${id}-s)`} />
          <Eyes style={a.eyes} simple={simple} />
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
