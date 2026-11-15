"use client";
// Public "Is my question leaked?" checker (owner: D). Streams Bright Data search results from /check/api.
import * as React from "react";
import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { SiteHeader } from "@/components/ui/site-header";
import { AgentAvatar } from "@/components/ui/agent-avatar";
import { PillButton } from "@/components/ui/chat/question-card";
import type { CheckEvent } from "./_lib/types";

const WATCHED = ["Quizlet", "Brainly", "Vaia", "Chegg", "Studocu", "Course Hero", "Numerade", "bartleby", "Transtutors", "Reddit"];
type Hit = Extract<CheckEvent, { type: "hit" }>;
type Phase = "idle" | "scanning" | "done" | "error";

export default function Page() {
  const [question, setQuestion] = React.useState("");
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [step, setStep] = React.useState<{ n: number; of: number; kind: string } | null>(null);
  const [hits, setHits] = React.useState<Hit[]>([]);
  const [done, setDone] = React.useState<Extract<CheckEvent, { type: "done" }> | null>(null);
  const [cachedRun, setCachedRun] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (phase === "scanning") return;
    setPhase("scanning");
    setHits([]);
    setDone(null);
    setStep(null);
    setError(null);
    try {
      const res = await fetch("/check/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "The check failed. Please try again.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          const line = p.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6)) as CheckEvent;
          if (ev.type === "start") setCachedRun(ev.cached);
          else if (ev.type === "query") setStep(ev);
          else if (ev.type === "hit") setHits((h) => [...h, ev]);
          else if (ev.type === "done") {
            setDone(ev);
            setPhase("done");
          } else if (ev.type === "error") throw new Error(ev.message);
        }
      }
    } catch (err) {
      setError((err as Error).message);
      setPhase("error");
    }
  }

  const litSites = new Set(hits.filter((h) => !h.partial).map((h) => h.site));
  const partialSites = new Set(hits.filter((h) => h.partial).map((h) => h.site));
  const extraSites = [...new Set(hits.map((h) => h.site))].filter((s) => !WATCHED.includes(s));
  const chips = [...WATCHED, ...extraSites];
  const valid = question.trim().length >= 20 && question.trim().length <= 600;

  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <main className="mx-auto flex max-w-[760px] flex-col gap-8 px-6 pb-20 pt-14">
        <div className="flex flex-col items-center gap-4 text-center">
          <AgentAvatar agent="leak-scout" size="lg" state={phase === "scanning" ? "active" : "idle"} />
          <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em]">Is your question already online?</h1>
          <p className="max-w-[540px] text-[16px] leading-relaxed text-muted-foreground">
            Paste a quiz or homework question. We search the web live and show which homework sites have it. In our study, 84% of textbook exercises were already there.
          </p>
        </div>

        <form onSubmit={check} className="rounded-[28px] border border-border bg-background shadow-[0_2px_12px_rgba(0,0,0,0.05)] focus-within:border-foreground/20">
          <label htmlFor="check-question" className="sr-only">
            Your question
          </label>
          <textarea
            id="check-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={4}
            maxLength={600}
            placeholder="e.g. A sample of 25 has mean 40 and standard deviation 10. What is the standard error of the mean?"
            className="block w-full resize-none bg-transparent px-5 pb-1 pt-4 text-[16px] leading-relaxed outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between gap-3 px-4 pb-3">
            <span className="num text-xs text-muted-foreground">{question.trim().length}/600</span>
            <PillButton id="check-submit" type="submit" disabled={!valid || phase === "scanning"}>
              {phase === "scanning" ? "Searching..." : "Check the web"}
            </PillButton>
          </div>
        </form>

        {phase !== "idle" && (
          <section aria-label="Scan" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
              <span>
                {phase === "scanning"
                  ? step
                    ? `Search ${step.n} of ${step.of}: ${step.kind === "exact" ? "exact phrase" : "keywords on homework sites"}`
                    : "Starting the search"
                  : phase === "done"
                    ? `${done?.serpCalls ?? 0} web search${done?.serpCalls === 1 ? "" : "es"} via Bright Data${cachedRun ? " (repeat check, from cache)" : ""}`
                    : ""}
              </span>
            </div>
            <ul className="flex flex-wrap gap-2" aria-label="Homework sites">
              {chips.map((s, i) => {
                const lit = litSites.has(s);
                const part = !lit && partialSites.has(s);
                return (
                  <li
                    key={s}
                    style={phase === "scanning" && !lit ? { animationDelay: `${i * 120}ms` } : undefined}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-colors duration-300",
                      lit ? "border-transparent bg-leak-soft font-medium text-leak" : part ? "border-dashed border-leak/40 text-leak/90" : "border-border text-muted-foreground",
                      phase === "scanning" && !lit && "animate-pulse",
                    )}
                  >
                    {s}
                    {lit && <span className="num ml-1.5 text-xs opacity-80">{hits.filter((h) => h.site === s && !h.partial).length}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {phase === "error" && error && (
          <p role="alert" className="rounded-2xl bg-muted px-4 py-3 text-sm">
            {error}
          </p>
        )}

        {phase === "done" && done && (
          <section aria-label="Report" className="overflow-hidden rounded-[20px] border border-border">
            <div className="flex flex-col gap-1 border-b border-border px-5 py-4">
              <span className="text-lg font-semibold">
                {done.found ? `Found on ${done.sites.length} site${done.sites.length > 1 ? "s" : ""}` : "Not found in today's search"}
              </span>
              <span className="text-sm text-muted-foreground">
                {done.found
                  ? "Anyone searching this question can find it, often with an answer next to it."
                  : "We didn't find it on the homework sites we search. That can change: questions leak after they're used."}
              </span>
            </div>
            {hits.length > 0 && (
              <ul className="divide-y divide-border">
                {hits.map((h) => (
                  <li key={h.url} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", h.partial ? "border border-dashed border-leak/40 text-leak/90" : "bg-leak-soft text-leak")}>{h.site}</span>
                    <a href={h.url} target="_blank" rel="noreferrer noopener nofollow" className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm text-brand hover:underline">
                      <span className="truncate">{h.host}</span>
                      <ExternalLink className="size-3 shrink-0" aria-hidden />
                    </a>
                    <span className="flex items-center gap-2" title="How much of your question's text appears in the search result">
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full rounded-full bg-leak" style={{ width: `${Math.round(h.matchScore * 100)}%` }} />
                      </span>
                      <span className="num w-9 text-right text-xs text-muted-foreground">{h.matchScore.toFixed(2)}</span>
                    </span>
                    {h.partial && <span className="w-full text-xs text-muted-foreground">Shares a phrase, but may be a different question.</span>}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-4">
              <span className="text-sm">
                {done.found ? "Rewrite it so a copied answer won't fit, and keep testing the same skill." : "Want to know if it leaks later, or whether an AI agent can answer it?"}
              </span>
              <Link href="/studio" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
                {done.found ? "Rewrite it with Unprompted" : "Open the professor studio"} <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
          </section>
        )}

        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          Your question is sent to a web search (via Bright Data) and is not stored; we keep only a one-way hash for an hour to avoid repeat searches. We show public links and match strength, never answers or copied content.{" "}
          <Link href="/study" className="underline hover:text-foreground">
            How we measured it
          </Link>
        </p>
      </main>
    </div>
  );
}
