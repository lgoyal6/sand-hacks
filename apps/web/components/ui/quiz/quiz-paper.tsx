"use client";
// The student quiz as a paper, not a chat (owner: D). Presentational only: the caller (C's quiz flow)
// owns state, grading, telemetry and every stable id. Layout:
//   header (logo · course · mode · progress)  |  question list  |  paper column  |  helpers margin
// When `scene` is set (the think-aloud), the page dims and the scene takes over the paper column.
import * as React from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";
import { AgentAvatar, resolveAgent } from "@/components/ui/agent-avatar";

export type NavState = "done" | "correct" | "incorrect" | "current" | "todo";

export interface QuizNavItem {
  id: string;
  label: string;
  state: NavState;
  onSelect?: () => void;
}

export interface Helper {
  /** Agent key or name, e.g. "tutor", "Explain coach". */
  agent: string;
  /** One short line under the name. */
  status: string;
  /** The single speaking helper shows `message` in a card. */
  active?: boolean;
  message?: React.ReactNode;
}

export interface QuizPaperProps {
  course: string;
  quizTitle: string;
  mode?: "practice" | "graded";
  /** 1-based. Omit both to hide progress (intro and summary screens). */
  current?: number;
  total?: number;
  nav?: QuizNavItem[];
  helpers?: Helper[];
  onAskTutor?: () => void;
  /** Main content: an intro, a question, or a summary. */
  children: React.ReactNode;
  /** The think-aloud scene. When set it replaces `children` and the page dims. */
  scene?: React.ReactNode;
  homeHref?: string;
  className?: string;
}

function NavDot({ state }: { state: NavState }) {
  if (state === "current") return <span aria-hidden className="size-2 rounded-full border-2 border-foreground" />;
  if (state === "correct" || state === "done") return <span aria-hidden className="size-2 rounded-full bg-verified" />;
  if (state === "incorrect") return <span aria-hidden className="size-2 rounded-full bg-gap" />;
  return <span aria-hidden className="size-2 rounded-full border-[1.5px] border-muted-foreground/40" />;
}

export function QuizPaper({
  course,
  quizTitle,
  mode,
  current,
  total,
  nav = [],
  helpers = [],
  onAskTutor,
  children,
  scene,
  homeHref = "/",
  className,
}: QuizPaperProps) {
  const inScene = !!scene;
  return (
    <div className={cn("flex min-h-svh flex-col transition-colors duration-300", inScene ? "bg-muted/60" : "bg-background", className)}>
      <header className={cn("flex flex-wrap items-center justify-between gap-4 border-b px-6 py-4 sm:px-8", inScene ? "border-transparent" : "border-border")}>
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href={homeHref} aria-label="Unprompted home" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Logo size={24} />
          </Link>
          <span className="text-muted-foreground/50">/</span>
          <span className="truncate text-sm text-muted-foreground">
            {course} · {quizTitle}
          </span>
          {mode && (
            <span className="ml-1 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">{mode === "practice" ? "Practice" : "Graded"}</span>
          )}
        </div>
        {current != null && total != null && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Question {current} of {total}
            </span>
            <div className="flex gap-1" aria-hidden>
              {Array.from({ length: total }, (_, i) => (
                <span key={i} className={cn("h-1 w-7 rounded-full", i < current ? "bg-foreground" : "bg-border")} />
              ))}
            </div>
          </div>
        )}
      </header>

      {inScene ? (
        <div className="flex flex-1 justify-center px-4 py-8 sm:px-6">{scene}</div>
      ) : (
        <div className="mx-auto flex w-full max-w-[1280px] flex-1 flex-wrap gap-12 px-6 pb-10 pt-12 sm:px-8">
          {nav.length > 0 && (
            <nav aria-label="Questions" className="hidden w-[120px] shrink-0 flex-col gap-1 lg:flex">
              <span className="mb-1.5 text-xs text-muted-foreground">Questions</span>
              {nav.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={n.onSelect}
                  disabled={!n.onSelect}
                  aria-current={n.state === "current" ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors enabled:hover:bg-muted disabled:cursor-default",
                    n.state === "current" && "bg-muted font-semibold text-foreground",
                  )}
                >
                  <NavDot state={n.state} />
                  {n.label}
                </button>
              ))}
            </nav>
          )}

          <main className="min-w-0 max-w-[720px] flex-[999_1_560px]">{children}</main>

          {(helpers.length > 0 || onAskTutor) && (
            <aside aria-label="Your helpers" className="flex w-full shrink-0 flex-col gap-3 lg:w-[260px]">
              <span className="text-xs text-muted-foreground">Your helpers</span>
              {helpers.map((h) => {
                const name = resolveAgent(h.agent)?.name ?? h.agent;
                return h.active && h.message ? (
                  <div key={h.agent} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-3.5">
                    <div className="flex items-center gap-2.5">
                      <AgentAvatar agent={h.agent} size={30} state="active" />
                      <span className="text-sm font-semibold">{name}</span>
                    </div>
                    <div className="text-sm leading-relaxed text-foreground/85">{h.message}</div>
                  </div>
                ) : (
                  <div key={h.agent} className="flex items-center gap-2.5 px-3.5 py-1.5">
                    <AgentAvatar agent={h.agent} size={26} state={h.active ? "active" : "muted"} />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm">{name}</span>
                      <span className="truncate text-xs text-muted-foreground">{h.status}</span>
                    </span>
                  </div>
                );
              })}
              {onAskTutor && (
                <button
                  type="button"
                  onClick={onAskTutor}
                  className="mt-2 flex h-11 items-center justify-center gap-2 rounded-full border border-border text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MessageCircle className="size-4" /> Ask the tutor
                </button>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

/** Question heading for the paper column: small topic line, then the stem as the hero. */
export function QuestionStem({ topic, children, id }: { topic?: string; children: React.ReactNode; id?: string }) {
  return (
    <div className="mb-7 flex flex-col gap-2.5">
      {topic && <span className="text-[13px] text-muted-foreground">{topic}</span>}
      <h1 id={id} className="text-[26px] font-semibold leading-[1.35] tracking-[-0.01em] sm:text-[28px]">
        {children}
      </h1>
    </div>
  );
}

/** Row under the choices: a hint on the left, the actions on the right. */
export function QuestionActions({ hint, children }: { hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{hint}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/** Inline feedback under a graded question (practice mode). Calm, never alarming. */
export function Feedback({ correct, children }: { correct: boolean; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "mt-6 rounded-2xl px-4 py-3.5 text-[15px] leading-relaxed",
        correct ? "bg-verified-soft text-foreground" : "bg-muted text-foreground",
      )}
    >
      <span className={cn("mr-1.5 font-semibold", correct ? "text-verified" : "text-foreground")}>{correct ? "That's right." : "Not quite."}</span>
      {children}
    </div>
  );
}

/** Intro / summary card for the paper column. */
export function PaperIntro({ title, children, actions }: { title: React.ReactNode; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 pt-6">
      <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.015em]">{title}</h1>
      {children && <div className="max-w-[560px] text-[16px] leading-relaxed text-muted-foreground">{children}</div>}
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
