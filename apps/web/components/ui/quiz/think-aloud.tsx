"use client";
// The think-aloud as a focused scene, not a chat message (owner: D). Presentational: C's probe flow passes
// the step, the agent, the orb state, the prompt and transcript, and puts its own inputs (with their stable
// ids: #confidence-before-N, #probe-explanation, #probe-cf-answer, ...) in `children` and `actions`.
import * as React from "react";
import { cn } from "@/lib/utils";
import { AgentAvatar, agentOrbColors, resolveAgent } from "@/components/ui/agent-avatar";
import { VoiceOrb, type VoiceOrbState } from "@/components/ui/siri-orb";

export type ThinkAloudStep = 1 | 2 | 3 | 4;

const STEPS: { n: ThinkAloudStep; label: string }[] = [
  { n: 1, label: "How sure?" },
  { n: 2, label: "Explain" },
  { n: 3, label: "What if" },
  { n: 4, label: "How sure now?" },
];

export function StepTrack({ step }: { step: ThinkAloudStep }) {
  return (
    <ol aria-label="Think-aloud steps" className="flex flex-wrap gap-1.5 text-[13px]">
      {STEPS.map((s) => (
        <li
          key={s.n}
          aria-current={s.n === step ? "step" : undefined}
          className={cn(
            "rounded-full px-3 py-1.5",
            s.n === step ? "bg-foreground text-background" : s.n < step ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {s.n} · {s.label}
        </li>
      ))}
    </ol>
  );
}

export interface ThinkAloudSceneProps {
  step: ThinkAloudStep;
  /** The question being explained, shrunk to a pill. */
  question: { label: string; stem: string; chosen?: string };
  agent?: string;
  /** Show the big orb (voice, or while the agent speaks). Omit for typed steps. */
  orb?: VoiceOrbState | null;
  /** The agent's prompt, large. */
  prompt?: React.ReactNode;
  /** What the student has said so far. */
  transcript?: React.ReactNode;
  /** Inputs for this step (confidence picker, textarea...). */
  children?: React.ReactNode;
  /** Buttons for this step. */
  actions?: React.ReactNode;
  /** Small line under the card (e.g. confidence before, grading note). */
  footer?: React.ReactNode;
  className?: string;
}

export function ThinkAloudScene({ step, question, agent = "explain-coach", orb, prompt, transcript, children, actions, footer, className }: ThinkAloudSceneProps) {
  const a = resolveAgent(agent);
  return (
    <div className={cn("flex w-full max-w-[1100px] flex-col items-center gap-7", className)}>
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 max-w-[640px] items-center gap-2.5 rounded-full border border-border bg-background py-2 pl-2.5 pr-4">
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{question.label}</span>
          <span className="truncate text-sm text-foreground/80">{question.stem}</span>
          {question.chosen && (
            <span className="shrink-0 whitespace-nowrap text-[13px] text-muted-foreground">
              You chose <strong className="font-semibold text-foreground">{question.chosen}</strong>
            </span>
          )}
        </div>
        <StepTrack step={step} />
      </div>

      <section
        aria-label="Think-aloud"
        className="flex w-full max-w-[760px] flex-col items-center gap-6 rounded-[28px] border border-border bg-background px-6 pb-8 pt-10 text-center sm:px-12"
      >
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <AgentAvatar agent={agent} size={22} state={orb === "speaking" ? "speaking" : orb === "thinking" ? "thinking" : "active"} />
          {a?.name ?? agent}
        </div>

        {prompt && <div className="max-w-[560px] text-[24px] font-semibold leading-[1.35] tracking-[-0.01em] sm:text-[26px]">{prompt}</div>}

        {orb && (
          <div className="relative flex flex-col items-center">
            <VoiceOrb state={orb} size="168px" showLabel colors={agentOrbColors(agent)} />
            {/* The family trait: the orb has eyes too. */}
            <span
              aria-hidden
              data-state={orb}
              className="ta-eyes pointer-events-none absolute left-1/2 top-[84px] flex -translate-x-1/2 -translate-y-1/2 gap-[22px]"
            >
              <span className="h-[30px] w-[13px] rounded-full bg-white/95 shadow-[0_1px_6px_rgba(0,0,0,0.12)]" />
              <span className="h-[30px] w-[13px] rounded-full bg-white/95 shadow-[0_1px_6px_rgba(0,0,0,0.12)]" />
            </span>
            <style href="unprompted-ta-eyes" precedence="default">{`
.ta-eyes>span{transform-origin:center;transition:transform .3s ease}
.ta-eyes[data-state="listening"]>span,.ta-eyes[data-state="idle"]>span{animation:ta-blink 4.8s ease-in-out infinite}
.ta-eyes[data-state="thinking"]{animation:ta-glance 2.8s ease-in-out infinite}
.ta-eyes[data-state="thinking"]>span{transform:scaleY(.55)}
.ta-eyes[data-state="speaking"]>span{animation:ta-open 1.1s ease-in-out infinite}
@keyframes ta-blink{0%,92%,100%{transform:scaleY(1)}95%,97%{transform:scaleY(.1)}}
@keyframes ta-glance{0%,100%{translate:-50% -50%}30%{translate:calc(-50% - 8px) -52%}65%{translate:calc(-50% + 8px) -52%}}
@keyframes ta-open{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.2)}}
@media (prefers-reduced-motion:reduce){.ta-eyes,.ta-eyes>span{animation:none!important}}
`}</style>
          </div>
        )}

        {transcript && (
          <div className="flex w-full max-w-[560px] flex-col gap-2 text-left">
            <span className="text-xs text-muted-foreground">What you&apos;ve said so far</span>
            <div className="text-[17px] leading-relaxed text-foreground/85">{transcript}</div>
          </div>
        )}

        {children && <div className="w-full max-w-[560px] text-left">{children}</div>}

        {actions && <div className="mt-1 flex flex-wrap justify-center gap-2.5">{actions}</div>}
      </section>

      {footer && <div className="flex w-full max-w-[760px] flex-wrap justify-between gap-3 text-[13px] text-muted-foreground">{footer}</div>}
    </div>
  );
}

/** 1..7 confidence, as big tappable pills. Keeps the `${name}-${n}` input ids (e.g. #confidence-before-6). */
export function ConfidencePicker({
  name,
  value,
  onChange,
  legend,
}: {
  name: string;
  value: number | null;
  onChange: (v: number) => void;
  legend: string;
}) {
  return (
    <fieldset id={`${name}-scale`} className="flex flex-col items-center gap-4">
      <legend className="mb-4 w-full text-center text-[17px] font-medium">{legend}</legend>
      <div className="flex flex-wrap justify-center gap-2" role="radiogroup">
        {[1, 2, 3, 4, 5, 6, 7].map((n) => (
          <label
            key={n}
            htmlFor={`${name}-${n}`}
            className="relative flex size-12 cursor-pointer items-center justify-center rounded-full border border-border text-[15px] font-medium transition-colors hover:bg-muted has-[:checked]:border-foreground has-[:checked]:bg-foreground has-[:checked]:text-background has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
          >
            <input className="sr-only" type="radio" id={`${name}-${n}`} name={name} value={n} checked={value === n} onChange={() => onChange(n)} />
            {n}
          </label>
        ))}
      </div>
      <div className="flex w-full max-w-[400px] justify-between text-xs text-muted-foreground">
        <span>1 · just guessing</span>
        <span>7 · could teach it</span>
      </div>
    </fieldset>
  );
}

/** Large textarea for typed explanations; pass id="probe-explanation" / "probe-cf-answer". */
export const ExplainBox = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function ExplainBox({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={5}
      className={cn(
        "w-full resize-none rounded-2xl border border-border bg-background px-4 py-3.5 text-[16px] leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
});
