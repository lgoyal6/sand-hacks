"use client";
// Studio as a conversation (owner: B). No LLM behind the composer: it maps plain requests
// to actions (show the attack, rewrite questions, replay, import) so it spends no quota.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SampleBadge } from "@/components/ui/sample-badge";
import { Textarea } from "@/components/ui/textarea";
import type { StudioData } from "../_lib/data";
import { cardsFromExperiments, initialRun, reduceRun, type RunState, type StudioEvent, type VariantCard as Card } from "../_lib/agents";
import { AgentsPanel } from "./agents-panel";
import { VariantCard } from "./variant-card";

type Msg =
  | { id: string; role: "professor"; text: string }
  | { id: string; role: "unprompted"; kind: "text"; text: string; actions?: Action[] }
  | { id: string; role: "unprompted"; kind: "attack" }
  | { id: string; role: "unprompted"; kind: "past" }
  | { id: string; role: "unprompted"; kind: "run"; runId: string };

type Action = { label: string; run: () => void; primary?: boolean };

const pct = (x: number) => `${Math.round(x * 100)}%`;
let seq = 0;
const nid = () => `m${++seq}`;

function qNum(itemId: string) {
  return itemId.match(/-q(\d+)$/)?.[1] ?? itemId;
}

export function StudioChat({ data }: { data: StudioData }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const quiz = data.quiz;
  const solvable = useMemo(() => data.solveRates.filter((r) => r.agentSolvable), [data.solveRates]);
  const fixtureBacked = data.quizSource === "fixtures" || data.experimentsSource === "fixtures";
  const say = useCallback((m: Omit<Extract<Msg, { kind: "text" }>, "id" | "role" | "kind">) => setMsgs((ms) => [...ms, { id: nid(), role: "unprompted", kind: "text", ...m }]), []);
  const push = useCallback((m: Msg) => setMsgs((ms) => [...ms, m]), []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, runs]);
  useEffect(() => {
    return () => {
      sourceRef.current?.close();
    };
  }, []);

  const startRun = useCallback(
    (qs: string) => {
      if (sourceRef.current) {
        say({ text: "A run is already going. I'll keep it on screen until it finishes." });
        return;
      }
      const runId = nid();
      setRuns((r) => ({ ...r, [runId]: initialRun() }));
      setActiveRun(runId);
      push({ id: nid(), role: "unprompted", kind: "run", runId });
      const es = new EventSource(`/studio/api/run?${qs}`);
      sourceRef.current = es;
      es.onmessage = (m) => {
        const e = JSON.parse(m.data) as StudioEvent;
        setRuns((r) => ({ ...r, [runId]: reduceRun(r[runId] ?? initialRun(), e) }));
        if (e.type === "run_finished") {
          es.close();
          sourceRef.current = null;
        }
      };
      es.onerror = () => {
        es.close();
        sourceRef.current = null;
        setRuns((r) => ({ ...r, [runId]: reduceRun(r[runId] ?? initialRun(), { type: "run_finished", ok: false, message: "Lost the connection to the run." }) }));
      };
    },
    [push, say],
  );

  const replay = useCallback(() => {
    const rec = data.recordings.at(-1);
    if (!rec) return say({ text: "There's no recorded run to replay yet." });
    startRun(`mode=replay&recording=${encodeURIComponent(rec)}`);
  }, [data.recordings, say, startRun]);

  const rewrite = useCallback(
    (itemIds: string[], attack: boolean) => startRun(`mode=live&items=${itemIds.join(",")}&n=2&attack=${attack ? 1 : 0}`),
    [startRun],
  );

  const offerRewrite = useCallback(
    (itemIds: string[]) => {
      const first = itemIds[0]!;
      say({
        text:
          `Rewriting writes 2 variants per question, solves each 3 times with code, has 3 models review it, then has the attack agents retake it. ` +
          `That's about 15 model calls per question before the re-test. The team's Gemini key is on the free tier, so I'd start with Q${qNum(first)} only.`,
        actions: [
          { label: `Rewrite Q${qNum(first)} (no re-test)`, primary: true, run: () => rewrite([first], false) },
          { label: `Rewrite Q${qNum(first)} and re-test with agents`, run: () => rewrite([first], true) },
          ...(data.recordings.length ? [{ label: "Replay the recorded run instead", run: replay }] : []),
        ],
      });
    },
    [data.recordings.length, replay, rewrite, say],
  );

  const showAttack = useCallback(() => {
    push({ id: nid(), role: "unprompted", kind: "attack" });
    if (solvable.length) {
      say({
        text: `${solvable.length} of ${quiz?.items.length ?? 0} questions are agent-solvable (solved in at least 60% of agent runs). Want me to rewrite them so agents fail but the skill stays the same?`,
        actions: [
          { label: "Rewrite agent-solvable questions", primary: true, run: () => offerRewrite(solvable.map((s) => s.itemId)) },
          ...(data.recordings.length ? [{ label: "Replay a recorded rewrite", run: replay }] : []),
        ],
      });
    }
  }, [data.recordings.length, offerRewrite, push, quiz?.items.length, replay, say, solvable]);

  const importQuiz = useCallback(
    async (markdown: string) => {
      push({ id: nid(), role: "professor", text: "(pasted a quiz)" });
      const res = await fetch("/studio/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markdown }) });
      const body = (await res.json()) as { quizId?: string; message?: string; error?: string };
      say({ text: res.ok ? `${body.message ?? "Imported."} It's saved as ${body.quizId}. Reload to work on it.` : (body.error ?? "Import failed.") });
    },
    [push, say],
  );

  const handle = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      if (/^#\s|^\d+\.\s*\[(mcq|multi|numeric|short)\]/im.test(t) && t.includes("\n")) return void importQuiz(t);
      push({ id: nid(), role: "professor", text: t });
      if (/attack|agents? (solve|do)|solve rate|how did/i.test(t)) return showAttack();
      if (/replay|recorded/i.test(t)) return replay();
      const qs = [...t.matchAll(/\bq(\d+)\b/gi)].map((m) => `${quiz?.id}-q${m[1]}`).filter((id) => quiz?.items.some((i) => i.id === id));
      if (/rewrite|transform|variant|fix|harden/i.test(t)) return offerRewrite(qs.length ? qs : solvable.map((s) => s.itemId));
      say({
        text: "I can show how agents did on this quiz, rewrite questions agents solve, replay a recorded rewrite, or import a quiz you paste in Markdown.",
        actions: [{ label: "Attack my quiz", primary: true, run: showAttack }],
      });
    },
    [importQuiz, offerRewrite, push, quiz, replay, say, showAttack, solvable],
  );

  const approve = useCallback(async (id: string, yes: boolean) => {
    const res = await fetch(`/studio/api/variants/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: yes ? "approve" : "unapprove" }) });
    if (res.ok) setApproved((a) => ({ ...a, [id]: yes }));
  }, []);

  const withApproval = (c: Card): Card =>
    approved[c.id] === undefined ? c : { ...c, status: approved[c.id] ? "approved" : c.status === "approved" ? "verified" : c.status };

  if (!quiz) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <EmptyState
          title="No quiz imported yet"
          description="Paste a quiz in Markdown. Unprompted will show which questions AI agents can answer, rewrite those, and keep only the versions agents fail."
          input={{ placeholder: "Paste a quiz in Markdown", submitLabel: "Import", onSubmit: (v) => void importQuiz(v) }}
        />
      </div>
    );
  }

  const run = activeRun ? (runs[activeRun] ?? null) : null;

  return (
    <div className="grid h-[calc(100dvh-0px)] grid-cols-1 lg:grid-cols-[1fr_300px]">
      <div className="flex min-h-0 flex-col">
        <header className="flex items-center gap-3 border-b px-6 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">Studio · {quiz.title}</h1>
            <p className="text-xs text-muted-foreground">
              {quiz.items.length} questions · quiz data from {data.quizSource === "neon" ? "Neon" : "fixtures"}
            </p>
          </div>
          {fixtureBacked ? <SampleBadge className="ml-auto" /> : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-5 px-6 py-6">
            <Bubble>
              <p>
                {quiz.title} is loaded with {quiz.items.length} questions. I can check how AI agents do on it and rewrite the questions they solve.
              </p>
              <Actions
                actions={[
                  { label: "Attack my quiz", primary: true, run: showAttack },
                  ...(data.experiments.length ? [{ label: `Show ${data.experiments.length} saved variant${data.experiments.length === 1 ? "" : "s"}`, run: () => push({ id: nid(), role: "unprompted", kind: "past" }) }] : []),
                ]}
              />
            </Bubble>

            {msgs.map((m) => {
              if (m.role === "professor") return <Mine key={m.id} text={m.text} />;
              if (m.kind === "text") {
                return (
                  <Bubble key={m.id}>
                    <p>{m.text}</p>
                    {m.actions ? <Actions actions={m.actions} /> : null}
                  </Bubble>
                );
              }
              if (m.kind === "attack") return <AttackSummary key={m.id} data={data} />;
              if (m.kind === "past") {
                return (
                  <Bubble key={m.id}>
                    <p className="mb-3">Saved variants for this quiz:</p>
                    <div className="space-y-2">
                      {cardsFromExperiments(data.experiments).map((c) => (
                        <VariantCard key={c.id} card={withApproval(c)} onApprove={approve} />
                      ))}
                    </div>
                  </Bubble>
                );
              }
              const r = runs[m.runId];
              return r ? <RunMessage key={m.id} run={r} withApproval={withApproval} onApprove={approve} /> : null;
            })}
            <div ref={endRef} />
          </div>
        </div>

        <form
          className="border-t px-6 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            handle(draft);
            setDraft("");
          }}
        >
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handle(draft);
                  setDraft("");
                }
              }}
              placeholder='Try "attack my quiz", "rewrite q1", or paste a quiz in Markdown'
              rows={1}
              className="max-h-40 min-h-9 flex-1 resize-none border-0 p-1 shadow-none focus-visible:ring-0"
            />
            <Button type="submit" size="icon" aria-label="Send" disabled={!draft.trim()}>
              <ArrowUp />
            </Button>
          </div>
        </form>
      </div>
      <div className="hidden min-h-0 lg:block">
        <AgentsPanel run={run} />
      </div>
    </div>
  );
}

function Bubble({ children }: { children: React.ReactNode }) {
  return <div className="text-sm leading-relaxed">{children}</div>;
}

function Mine({ text }: { text: string }) {
  return <div className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-2xl bg-muted px-4 py-2 text-sm">{text}</div>;
}

function Actions({ actions }: { actions: Action[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.map((a) => (
        <Button key={a.label} size="sm" variant={a.primary ? "default" : "outline"} onClick={a.run}>
          {a.label}
        </Button>
      ))}
    </div>
  );
}

function AttackSummary({ data }: { data: StudioData }) {
  const items = data.quiz?.items ?? [];
  if (!data.solveRates.length) {
    return (
      <Bubble>
        <p>No agent runs on this quiz yet. Workstream A&apos;s attack runner hasn&apos;t produced solve rates for it.</p>
      </Bubble>
    );
  }
  const a = data.attack;
  return (
    <div className="rounded-lg border bg-card px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="font-medium">Agent attack</p>
        {a ? (
          <p className="text-muted-foreground">
            <span className="num">
              {a.itemCorrect}/{a.itemRuns}
            </span>{" "}
            answers correct ({pct(a.accuracy)}, 95% CI <span className="num">{pct(a.ci95[0])}-{pct(a.ci95[1])}</span>) · {a.models.join(", ").replace(/\|/g, " on ")}
          </p>
        ) : (
          <SampleBadge />
        )}
      </div>
      <ul className="mt-3 divide-y">
        {items.map((it) => {
          const r = data.solveRates.find((s) => s.itemId === it.id);
          return (
            <li key={it.id} className="flex items-center gap-3 py-2">
              <span className="w-8 shrink-0 font-medium">Q{qNum(it.id)}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{it.stem}</span>
              {r ? (
                <span className={`num shrink-0 rounded-full px-2 py-0.5 text-xs ${r.agentSolvable ? "bg-agent-soft text-agent" : "bg-muted text-muted-foreground"}`}>
                  {r.correct}/{r.runs} solved
                </span>
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">not attacked</span>
              )}
            </li>
          );
        })}
      </ul>
      {a && a.itemRuns / Math.max(1, items.length) < 3 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Small sample: {Math.round(a.itemRuns / Math.max(1, items.length))} runs per question so far.
        </p>
      ) : null}
    </div>
  );
}

function RunMessage({ run, withApproval, onApprove }: { run: RunState; withApproval: (c: Card) => Card; onApprove: (id: string, yes: boolean) => Promise<void> }) {
  const cards = run.order.map((id) => withApproval(run.cards[id]!));
  const count = (s: Card["status"]) => cards.filter((c) => c.status === s).length;
  const decided = cards.filter((c) => ["verified", "approved", "rejected", "unverified"].includes(c.status)).length;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">{run.label ?? "Starting…"}</p>
      <div className="space-y-2">
        {cards.map((c) => (
          <VariantCard key={c.id} card={c} onApprove={run.mode === "replay" ? undefined : onApprove} />
        ))}
      </div>
      {run.running ? (
        <p className="text-xs text-muted-foreground">
          {decided} of {cards.length} variant{cards.length === 1 ? "" : "s"} decided…
        </p>
      ) : run.finished ? (
        <p>
          {cards.length} variant{cards.length === 1 ? "" : "s"}: {count("verified") + count("approved")} verified, {count("rejected")} rejected,{" "}
          {count("unverified") + cards.filter((c) => c.status === "checking" || c.status === "generating" || c.status === "re-attacking").length} not verified.
          {run.finished.message ? <span className="text-muted-foreground"> {run.finished.message}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
