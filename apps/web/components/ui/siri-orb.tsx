"use client";
// Siri Orb, adapted from 21st.dev (@educalvolpz/siri-orb). Unprompted: themed colors, scoped keyframes, VoiceOrb states.
import * as React from "react";
import { cn } from "@/lib/utils";
const SIZE_THRESHOLD_SMALL = 50;
const SIZE_THRESHOLD_TINY = 30;
const SIZE_THRESHOLD_MEDIUM = 100;
const BLUR_MULTIPLIER_SMALL = 0.008;
const BLUR_MIN_SMALL = 1;
const BLUR_MULTIPLIER_LARGE = 0.015;
const BLUR_MIN_LARGE = 4;
const CONTRAST_MULTIPLIER_SMALL = 0.004;
const CONTRAST_MIN_SMALL = 1.2;
const CONTRAST_MULTIPLIER_LARGE = 0.008;
const CONTRAST_MIN_LARGE = 1.5;
const DOT_SIZE_MULTIPLIER_SMALL = 0.004;
const DOT_SIZE_MIN_SMALL = 0.05;
const DOT_SIZE_MULTIPLIER_LARGE = 0.008;
const DOT_SIZE_MIN_LARGE = 0.1;
const SHADOW_MULTIPLIER_SMALL = 0.004;
const SHADOW_MIN_SMALL = 0.5;
const SHADOW_MULTIPLIER_LARGE = 0.008;
const SHADOW_MIN_LARGE = 2;
const MASK_RADIUS_TINY = "0%";
const MASK_RADIUS_SMALL = "5%";
const MASK_RADIUS_MEDIUM = "15%";
const MASK_RADIUS_LARGE = "25%";
const CONTRAST_TINY = 1.1;
const CONTRAST_MULTIPLIER_FINAL = 1.2;
const CONTRAST_MIN_FINAL = 1.3;
export interface SiriOrbProps {
  animationDuration?: number;
  className?: string;
  colors?: {
    bg?: string;
    c1?: string;
    c2?: string;
    c3?: string;
  };
  size?: string;
}
export const SiriOrb: React.FC<SiriOrbProps> = ({
  size = "192px",
  className,
  colors,
  animationDuration = 20,
}) => {
  const defaultColors = {
    bg: "var(--background)",
    c1: "var(--brand)",
    c2: "var(--chart-2)",
    c3: "var(--chart-4)",
  };
  const finalColors = { ...defaultColors, ...colors };
  const sizeValue = Number.parseInt(size.replace("px", ""), 10);
  const blurAmount =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * BLUR_MULTIPLIER_SMALL, BLUR_MIN_SMALL)
      : Math.max(sizeValue * BLUR_MULTIPLIER_LARGE, BLUR_MIN_LARGE);
  const contrastAmount =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * CONTRAST_MULTIPLIER_SMALL, CONTRAST_MIN_SMALL)
      : Math.max(sizeValue * CONTRAST_MULTIPLIER_LARGE, CONTRAST_MIN_LARGE);
  const dotSize =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * DOT_SIZE_MULTIPLIER_SMALL, DOT_SIZE_MIN_SMALL)
      : Math.max(sizeValue * DOT_SIZE_MULTIPLIER_LARGE, DOT_SIZE_MIN_LARGE);
  const shadowSpread =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * SHADOW_MULTIPLIER_SMALL, SHADOW_MIN_SMALL)
      : Math.max(sizeValue * SHADOW_MULTIPLIER_LARGE, SHADOW_MIN_LARGE);
  const getMaskRadius = (value: number) => {
    if (value < SIZE_THRESHOLD_TINY) return MASK_RADIUS_TINY;
    if (value < SIZE_THRESHOLD_SMALL) return MASK_RADIUS_SMALL;
    if (value < SIZE_THRESHOLD_MEDIUM) return MASK_RADIUS_MEDIUM;
    return MASK_RADIUS_LARGE;
  };
  const maskRadius = getMaskRadius(sizeValue);
  const getFinalContrast = (value: number) => {
    if (value < SIZE_THRESHOLD_TINY) return CONTRAST_TINY;
    if (value < SIZE_THRESHOLD_SMALL) {
      return Math.max(
        contrastAmount * CONTRAST_MULTIPLIER_FINAL,
        CONTRAST_MIN_FINAL
      );
    }
    return contrastAmount;
  };
  const finalContrast = getFinalContrast(sizeValue);
  return (
    <div
      className={cn("siri-orb", className)}
      style={
        {
          width: size,
          height: size,
          "--bg": finalColors.bg,
          "--c1": finalColors.c1,
          "--c2": finalColors.c2,
          "--c3": finalColors.c3,
          "--animation-duration": `${animationDuration}s`,
          "--blur-amount": `${blurAmount}px`,
          "--contrast-amount": finalContrast,
          "--dot-size": `${dotSize}px`,
          "--shadow-spread": `${shadowSpread}px`,
          "--mask-radius": maskRadius,
        } as React.CSSProperties
      }
    >
      <style>{`
        @property --angle {
          syntax: "<angle>";
          inherits: false;
          initial-value: 0deg;
        }
        .siri-orb {
          display: grid;
          grid-template-areas: "stack";
          overflow: hidden;
          border-radius: 50%;
          position: relative;
        }
        .siri-orb::before,
        .siri-orb::after {
          content: "";
          display: block;
          grid-area: stack;
          width: 100%;
          height: 100%;
          border-radius: 50%;
        }
        .siri-orb::before {
          background:
            conic-gradient(
              from calc(var(--angle) * 2) at 25% 70%,
              var(--c3),
              transparent 20% 80%,
              var(--c3)
            ),
            conic-gradient(
              from calc(var(--angle) * 2) at 45% 75%,
              var(--c2),
              transparent 30% 60%,
              var(--c2)
            ),
            conic-gradient(
              from calc(var(--angle) * -3) at 80% 20%,
              var(--c1),
              transparent 40% 60%,
              var(--c1)
            ),
            conic-gradient(
              from calc(var(--angle) * 2) at 15% 5%,
              var(--c2),
              transparent 10% 90%,
              var(--c2)
            ),
            conic-gradient(
              from calc(var(--angle) * 1) at 20% 80%,
              var(--c1),
              transparent 10% 90%,
              var(--c1)
            ),
            conic-gradient(
              from calc(var(--angle) * -2) at 85% 10%,
              var(--c3),
              transparent 20% 80%,
              var(--c3)
            );
          box-shadow: inset var(--bg) 0 0 var(--shadow-spread)
            calc(var(--shadow-spread) * 0.2);
          filter: blur(var(--blur-amount)) contrast(var(--contrast-amount));
          animation: siri-orb-rotate var(--animation-duration) linear infinite;
        }
        .siri-orb::after {
          background-image: radial-gradient(
            circle at center,
            var(--bg) var(--dot-size),
            transparent var(--dot-size)
          );
          background-size: calc(var(--dot-size) * 2) calc(var(--dot-size) * 2);
          backdrop-filter: blur(calc(var(--blur-amount) * 2))
            contrast(calc(var(--contrast-amount) * 2));
          mix-blend-mode: overlay;
        }
        .siri-orb[style*="--mask-radius: 0%"]::after {
          mask-image: none;
        }
        .siri-orb:not([style*="--mask-radius: 0%"])::after {
          mask-image: radial-gradient(
            black var(--mask-radius),
            transparent 75%
          );
        }
        @keyframes siri-orb-rotate {
          to {
            --angle: 360deg;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .siri-orb::before {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
};

export type VoiceOrbState = "idle" | "listening" | "thinking" | "speaking";

const STATE_DURATION: Record<VoiceOrbState, number> = { idle: 30, listening: 14, thinking: 8, speaking: 4 };
const STATE_LABEL: Record<VoiceOrbState, string> = {
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

export interface VoiceOrbProps {
  state?: VoiceOrbState;
  /** Any CSS length in px, e.g. "160px". */
  size?: string;
  /** Show the state label under the orb. */
  showLabel?: boolean;
  /** Override orb colors (e.g. agentOrbColors(agent) so the orb takes the speaking agent's hue). */
  colors?: SiriOrbProps["colors"];
  className?: string;
}

/** The think-aloud interviewer. Rotation speeds up while it speaks and settles while it listens. */
export function VoiceOrb({ state = "idle", size = "160px", showLabel = false, colors: override, className }: VoiceOrbProps) {
  const colors = override ??
    state === "thinking"
      ? { c1: "var(--chart-3)", c2: "var(--agent)", c3: "var(--chart-2)" }
      : state === "speaking"
        ? { c1: "var(--brand)", c2: "var(--chart-2)", c3: "var(--near-miss)" }
        : undefined;
  return (
    <div className={cn("inline-flex flex-col items-center gap-3", className)} data-slot="voice-orb" data-state={state}>
      <div
        className={cn(
          "rounded-full transition-transform duration-500 ease-out motion-reduce:transition-none",
          state === "speaking" && "scale-105",
          state === "idle" && "opacity-80",
        )}
        style={{ boxShadow: state === "listening" ? "0 0 0 6px color-mix(in oklch, var(--brand) 12%, transparent)" : undefined, borderRadius: "9999px" }}
      >
        <SiriOrb size={size} animationDuration={STATE_DURATION[state]} colors={colors} />
      </div>
      <span className={cn("text-sm text-muted-foreground", !showLabel && "sr-only")} role="status" aria-live="polite">
        {STATE_LABEL[state]}
      </span>
    </div>
  );
}
