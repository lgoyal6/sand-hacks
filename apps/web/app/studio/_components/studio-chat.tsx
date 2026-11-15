"use client";
// Studio as a conversation (owner: B), on D's chat shell. No LLM behind the composer: it maps
// plain requests to actions (attack results, rewrite, replay, import), so it spends no quota.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileUp, GitBranch, Globe, History, Link2, Target } from "lucide-react";
import { CanvasCard } from "./canvas-card";
import { AppealPicker } from "./appeal-picker";
import { TreeCard } from "./tree-card";
import type { TreeData } from "../_lib/tree";
import type { LeakFinding } from "@unprompted/shared";
import { LeakRadar } from "@/components/dashboard/leak-radar";
import { buildLeakRadar, type LeakRadarData } from "@/components/dashboard/leak-radar-data";
import { ChatLayout, Chip, Composer, Message, PillButton, Thinking, Thread, type AgentInfo } from "@/components/ui/chat";
import { APP_LINKS } from "@/components/ui/app-shell";
import type { StudioData } from "../_lib/data";
import {
  AGENT_ORDER,
  AGENT_IDS,
  AGENT_ROLE,
  cardToExperiment,
  cardsFromExperiments,
  initialRun,
  reduceRun,
  type RunState,
  type StudioEvent,
  type VariantCard as Card,
} from "../_lib/agents";
import { VariantCard, type Decision } from "./variant-card";
import { RaceCard } from "./race-card";
import { buildRace, type RaceData } from "../_lib/race";

type Action = { label: string; run: () => void; primary?: boolean };
type Msg =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; agent?: string; kind: "text"; text: string; actions?: Action[] }
  | { id: string; role: "assistant"; agent?: string; kind: "attack" }
  | { id: string; role: "assistant"; agent?: string; kind: "saved" }
  | { id: string; role: "assistant"; agent?: string; kind: "run"; runId: string }
  | { id: string; role: "assistant"; agent?: string; kind: "import" }
  | { id: string; role: "assistant"; agent?: string; kind: "leaks"; text: string; radar: LeakRadarData | null; done: boolean; error?: string }
  | { id: string; role: "assistant"; agent?: string; kind: "tree" }
  | { id: string; role: "assistant"; agent?: string; kind: "canvas" }
  | { id: string; role: "assistant"; agent?: string; kind: "appeal" };

const pct = (x: number) => `${Math.round(x * 100)}%`;
let seq = 0;
const nid = () => `m${++seq}`;
const qNum = (itemId: string) => itemId.match(/-q(\d+)$/)?.[1] ?? itemId;

/** "Sample quiz: Intro Statistics (OpenStax-style, written by us)" -> "Intro Statistics". */
function displayTitle(t: string) {
  return t.replace(/^sample quiz:\s*/i, "").replace(/\s*\([^)]*\)\s*$/, "").trim() || t;
}

export function StudioChat({ data }: { data: StudioData }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, Card["status"]>>({});
  const [resumed, setResumed] = useState<Record<string, boolean>>({});
  const [decideError, setDecideError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const quiz = data.quiz;
  const title = quiz ? displayTitle(quiz.title) : "Studio";
  const solvable = useMemo(() => data.solveRates.filter((r) => r.agentSolvable), [data.solveRates]);

  const push = useCallback((m: Msg) => setMsgs((ms) => [...ms, m]), []);
  const say = useCallback(
    (text: string, opts: { agent?: string; actions?: Action[] } = {}) => push({ id: nid(), role: "assistant", kind: "text", text, ...opts }),
    [push],
  );
  useEffect(() => () => sourceRef.current?.close(), []);

  // ---- actions ----
  const startRun = useCallback(
    (qs: string) => {
      if (sourceRef.current) return say("A run is already going. I'll show it here until it finishes.");
      const runId = nid();
      setRuns((r) => ({ ...r, [runId]: initialRun() }));
      setActiveRun(runId);
      push({ id: nid(), role: "assistant", agent: "Rewriter", kind: "run", runId });
      const es = new EventSource(`/studio/api/run?${qs}`);
      sourceRef.current = es;
      const apply = (e: StudioEvent) => setRuns((r) => ({ ...r, [runId]: reduceRun(r[runId] ?? initialRun(), e) }));
      es.onmessage = (m) => {
        const e = JSON.parse(m.data) as StudioEvent;
        apply(e);
        if (e.type === "run_finished") {
          es.close();
          sourceRef.current = null;
        }
      };
      es.onerror = () => {
        es.close();
        sourceRef.current = null;
        apply({ type: "run_finished", ok: false, message: "Lost the connection to the run." });
      };
    },
    [push, say],
  );

  const replay = useCallback(() => {
    const rec = data.recordings.at(-1);
    if (!rec) return say("There's no recorded run to replay yet.");
    startRun(`mode=replay&recording=${encodeURIComponent(rec)}`);
  }, [data.recordings, say, startRun]);

  const rewrite = useCallback(
    (itemIds: string[], attack: boolean) => startRun(`mode=live&items=${itemIds.join(",")}&n=2&attack=${attack ? 1 : 0}`),
    [startRun],
  );

  const offerRewrite = useCallback(
    (itemIds: string[]) => {
      if (!itemIds.length) return say("No questions are agent-solvable yet, so there's nothing to rewrite.");
      const first = itemIds[0]!;
      say(
        `I'll write 2 versions of Q${qNum(first)}, solve each 3 times with code, have 3 models check the skill and wording, then have the agents retake the survivors. ` +
          `That's about 15 model calls before the retake, and the team's Gemini key is on the free tier, so let's start with one question.`,
        {
          agent: "Rewriter",
          actions: [
            { label: `Rewrite Q${qNum(first)}`, primary: true, run: () => rewrite([first], false) },
            { label: "Rewrite and retake with agents", run: () => rewrite([first], true) },
            ...(data.recordings.length ? [{ label: "Replay a recorded run", run: replay }] : []),
          ],
        },
      );
    },
    [data.recordings.length, replay, rewrite, say],
  );

  const showAttack = useCallback(() => {
    push({ id: nid(), role: "user", text: "Attack my quiz" });
    push({ id: nid(), role: "assistant", agent: "Quiz checker", kind: "attack" });
    if (solvable.length) {
      say(
        `Agents can answer ${solvable.length} of ${quiz?.items.length ?? 0} questions. I can write new versions that keep the same answer and skill and aren't already online, so copied answer keys stop working. In our tests agents still solve reasonable rewrites, so for these questions the think-aloud check is what shows real understanding.`,
        {
          actions: [{ label: "Write new versions", primary: true, run: () => offerRewrite(solvable.map((s) => s.itemId)) }],
        },
      );
    }
  }, [offerRewrite, push, quiz?.items.length, say, solvable]);

  const importQuiz = useCallback(
    async (markdown: string) => {
      push({ id: nid(), role: "user", text: "Imported a quiz from Markdown" });
      const res = await fetch("/studio/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markdown }) });
      const body = (await res.json()) as { quizId?: string; message?: string; error?: string };
      say(res.ok ? `${body.message ?? "Imported."} Saved as ${body.quizId}.` : (body.error ?? "Import failed."));
    },
    [push, say],
  );

  // Leak scout (Mastra agent behind /api/agents): streams AgentEvents to the panel, findings -> D's LeakRadar.
  const checkLeaks = useCallback(async () => {
    if (!quiz) return;
    push({ id: nid(), role: "user", text: "Is any of this quiz already online?" });
    const id = nid();
    push({ id, role: "assistant", agent: "Leak scout", kind: "leaks", text: "", radar: null, done: false });
    const patch = (p: Partial<Extract<Msg, { kind: "leaks" }>>) => setMsgs((ms) => ms.map((m) => (m.id === id ? ({ ...m, ...p } as Msg) : m)));
    try {
      const res = await fetch("/api/agents/leak-scout/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: `Is anything from my quiz "${quiz.id}" (quizId ${quiz.id}) already online?` }),
      });
      if (!res.ok || !res.body) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        return patch({ done: true, error: b.error ?? `Leak scout unavailable (${res.status}).` });
      }
      const dec = new TextDecoder();
      let buf = "";
      let text = "";
      for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += dec.decode(part, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          const o = JSON.parse(line) as { type?: string; text?: string; message?: string; agentId?: string; toolCall?: { name: string; result?: { findings?: LeakFinding[] } } };
          if (o.agentId) {
            window.dispatchEvent(new CustomEvent("unprompted:agent-status", { detail: o }));
            const findings = o.toolCall?.result?.findings;
            if (findings) patch({ radar: buildLeakRadar(quiz, findings, { archiveWatch: { status: "off" } }) });
          } else if (o.type === "delta" && o.text) {
            text += o.text;
            patch({ text });
          } else if (o.type === "message") {
            patch({ text: o.text ?? text, done: true });
          } else if (o.type === "error") {
            patch({ done: true, error: o.message });
          }
        }
      }
      patch({ done: true });
    } catch {
      patch({ done: true, error: "Lost the connection to the Leak scout." });
    }
  }, [push, quiz]);

  // Canvas QTI round trip: import an export zip, export the delivered quiz (approved variants in place).
  const fileRef = useRef<HTMLInputElement>(null);
  const importCanvas = useCallback(
    async (file: File) => {
      push({ id: nid(), role: "user", text: `Imported ${file.name} from Canvas` });
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/studio/api/qti/import", { method: "POST", body });
      const r = (await res.json().catch(() => ({}))) as { quizId?: string; title?: string; items?: number; skipped?: { title: string; type: string }[]; error?: string };
      if (!res.ok) return say(r.error ?? "Import failed.");
      const skipped = r.skipped?.length ? ` Skipped ${r.skipped.length} question${r.skipped.length === 1 ? "" : "s"} of a type we don't support yet (${[...new Set(r.skipped.map((x) => x.type.replace(/_question$/, "").replace(/_/g, " ")))].join(", ")}).` : "";
      say(`Imported "${r.title}" from Canvas: ${r.items} question${r.items === 1 ? "" : "s"}, saved as ${r.quizId}.${skipped}`);
    },
    [push, say],
  );
  const exportCanvas = useCallback(async () => {
    if (!quiz) return;
    push({ id: nid(), role: "user", text: "Export this quiz for Canvas" });
    const res = await fetch(`/studio/api/qti/export?quiz=${encodeURIComponent(quiz.id)}`);
    if (!res.ok) {
      const r = (await res.json().catch(() => ({}))) as { error?: string };
      return say(r.error ?? "Export failed.");
    }
    const summary = JSON.parse(res.headers.get("X-Export-Summary") ?? "{}") as { exported?: number; variants?: string[] };
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${quiz.id}-canvas-qti.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    const n = summary.variants?.length ?? 0;
    say(
      `Downloaded ${quiz.id}-canvas-qti.zip with ${summary.exported ?? "the"} questions${n ? `, including ${n} approved rewrite${n === 1 ? "" : "s"}` : " (no approved rewrites yet, so these are the originals)"}. In Canvas: Settings, Import Course Content, "QTI .zip file".`,
    );
  }, [push, quiz, say]);

  const handle = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      if (/^#\s|^\d+\.\s*\[(mcq|multi|numeric|short)\]/im.test(t) && t.includes("\n")) return void importQuiz(t);
      if (/attack|agents? (solve|do)|solve rate|how did/i.test(t)) return showAttack();
      push({ id: nid(), role: "user", text: t });
      if (/replay|recorded/i.test(t)) return replay();
      if (/leak|online|published|posted|quizlet|chegg|reddit/i.test(t)) return void checkLeaks();
      if (/what .*saw|appeal|time.?travel/i.test(t)) return push({ id: nid(), role: "assistant", kind: "appeal" });
      if (/connect\s+canvas|import.*canvas|canvas.*course/i.test(t)) return push({ id: nid(), role: "assistant", kind: "canvas" });
      if (/export|canvas/i.test(t)) return void exportCanvas();
      if (/tree|branch|neon/i.test(t)) return push({ id: nid(), role: "assistant", agent: "Rewriter", kind: "tree" });
      if (/saved|past|previous/i.test(t) && data.experiments.length) return push({ id: nid(), role: "assistant", agent: "Rewriter", kind: "saved" });
      const qs = [...t.matchAll(/\bq(\d+)\b/gi)].map((m) => `${quiz?.id}-q${m[1]}`).filter((id) => quiz?.items.some((i) => i.id === id));
      if (/rewrite|transform|variant|fix|harden/i.test(t)) return offerRewrite(qs.length ? qs : solvable.map((s) => s.itemId));
      say("I can show how agents did on this quiz, rewrite the questions they answer, replay a recorded rewrite, or import a quiz you paste in Markdown.", {
        actions: [{ label: "Attack my quiz", primary: true, run: showAttack }],
      });
    },
    [checkLeaks, data.experiments.length, exportCanvas, importQuiz, offerRewrite, push, quiz, replay, say, showAttack, solvable],
  );

  const decide = useCallback(
    async (id: string, d: Decision, runId?: string) => {
      setDecideError(null);
      // While the Mastra run is paused, the first decision resumes it; later ones write directly.
      const viaRun = runId && !resumed[runId] && d !== "unapprove" ? runId : undefined;
      const res = await fetch(`/studio/api/variants/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: d, runId: viaRun }),
      });
      const body = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
      if (!res.ok) return setDecideError(body.error ?? "That didn't go through.");
      if (viaRun) setResumed((r) => ({ ...r, [viaRun]: true }));
      setDecided((m) => ({ ...m, [id]: d === "approve" ? "approved" : d === "reject" ? "rejected" : "verified" }));
    },
    [resumed],
  );
  const withDecision = useCallback(
    (c: Card): Card => (decided[c.id] ? { ...c, status: decided[c.id]!, reason: decided[c.id] === "rejected" ? "Rejected by you." : c.reason } : c),
    [decided],
  );

  // ---- right panel: real run state, else a calm summary of what's known ----
  const run = activeRun ? (runs[activeRun] ?? null) : null;
  const agents: AgentInfo[] = AGENT_ORDER.map((name) => {
    const row = run?.agents[name];
    if (row && row.status !== "idle") return { id: AGENT_IDS[name], name, status: row.activity, state: row.status, steps: row.steps };
    if (row?.steps.length) return { id: AGENT_IDS[name], name, status: row.activity, state: "idle", steps: row.steps };
    if (name === "Quiz checker" && data.attack) {
      return {
        id: AGENT_IDS[name],
        name,
        status: `answered ${data.attack.itemCorrect}/${data.attack.itemRuns} on the original quiz`,
        state: "complete",
        steps: [{ text: data.attack.models.map((m) => m.replace("|", " on ")).join(", ") }],
      };
    }
    return { id: AGENT_IDS[name], name, status: AGENT_ROLE[name].toLowerCase(), state: "idle" };
  });

  const sidebar = {
    groups: [{ label: "Quizzes", items: [{ id: quiz?.id ?? "none", title, meta: quiz ? `${quiz.items.length} questions` : undefined, href: "/studio" }] }],
    links: APP_LINKS,
    user: { name: "Professor", detail: title },
  };
  const composer = (
    <>
      <Composer textareaId="studio-composer" submitId="studio-send" placeholder="Ask the agents, paste a quiz in Markdown, or attach a Canvas export" onSubmit={handle} onAttach={() => fileRef.current?.click()} />
      <input
        ref={fileRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        aria-label="Canvas quiz export (.zip)"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void importCanvas(f);
        }}
      />
    </>
  );
  const sourceNote =
    data.quizSource === "neon" && data.solveRatesMeasured
      ? `Agent results: ${data.attack?.itemRuns ?? 0} real answers.`
      : "Some of this view uses sample data.";

  if (!quiz) {
    return (
      <ChatLayout
        sidebar={sidebar}
        agents={agents}
        empty={msgs.length === 0}
        home={{
          greeting: "Which quiz should we test?",
          sub: "Paste a quiz in Markdown to start.",
          chips: (
            <Chip icon={<FileUp />} onClick={() => say("Paste the quiz into the box below. Each question looks like: 1. [mcq] Question text, then choices with (answer) after the right one, then objective: what it tests.")}>
              How to format a quiz
            </Chip>
          ),
        }}
        composer={composer}
      >
        <Thread>{msgs.map(renderMsg)}</Thread>
      </ChatLayout>
    );
  }

  // Show an agent's name only when the speaker changes (D's thread convention).
  const speakers = msgs.map((m) => (m.role === "user" ? "__user" : (m.agent ?? "")));
  const nameFor = (m: Msg) => {
    if (m.role === "user" || !m.agent) return undefined;
    const i = msgs.indexOf(m);
    return i > 0 && speakers[i - 1] === m.agent ? undefined : m.agent;
  };

  function renderMsg(m: Msg) {
    if (m.role === "user") {
      return (
        <Message key={m.id} role="user">
          {m.text}
        </Message>
      );
    }
    if (m.kind === "text") {
      return (
        <Message key={m.id} role="assistant" agentName={nameFor(m)} copyText={m.text}>
          <p>{m.text}</p>
          {m.actions ? <Actions actions={m.actions} /> : null}
        </Message>
      );
    }
    if (m.kind === "attack") {
      return (
        <Message key={m.id} role="assistant" agentName={nameFor(m)}>
          <AttackSummary data={data} />
        </Message>
      );
    }
    if (m.kind === "leaks") {
      return (
        <Message key={m.id} role="assistant" agentName={nameFor(m)}>
          {m.error ? <p className="text-muted-foreground">{m.error}</p> : m.text ? <p>{withBold(m.text)}</p> : null}
          {m.radar ? (
            <div className="mt-3">
              <LeakRadar data={m.radar} />
            </div>
          ) : !m.done ? (
            <div className="mt-2">
              <Thinking label="Leak scout is checking the web" />
            </div>
          ) : null}
        </Message>
      );
    }
    if (m.kind === "appeal") {
      return (
        <Message key={m.id} role="assistant" agentName={nameFor(m)}>
          <p>Pick an attempt. I&apos;ll branch the database at the moment it started and show the quiz exactly as that student saw it.</p>
          <div className="mt-3">
            <AppealPicker quizId={quiz!.id} />
          </div>
        </Message>
      );
    }
    if (m.kind === "canvas") {
      return (
        <Message key={m.id} role="assistant" agentName={nameFor(m)}>
          <CanvasCard
            onImported={(r) =>
              say(`Imported "${r.title}" from Canvas: ${r.items} question${r.items === 1 ? "" : "s"}${r.skipped?.length ? `, ${r.skipped.length} skipped (unsupported types)` : ""}.`, {
                actions: [{ label: "Open it here and attack it", primary: true, run: () => (window.location.href = `/studio?quiz=${encodeURIComponent(r.quizId)}`) }],
              })
            }
          />
        </Message>
      );
    }
    if (m.kind === "tree") {
      return (
        <Message key={m.id} role="assistant" agentName={nameFor(m)}>
          <p>Here is every rewrite tried on this quiz, as branches of the quiz database:</p>
          <div className="mt-3">
            <TreeLoader quizId={quiz!.id} />
          </div>
        </Message>
      );
    }
    if (m.kind === "saved") {
      return (
        <Message key={m.id} role="assistant" agentName={nameFor(m)}>
          <p>Every rewrite tried so far, one race per question:</p>
          <SavedRaces itemIds={[...new Set(data.experiments.map((e) => e.itemId))]} onMerge={(id) => decide(id, "approve")} />
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground">Show the versions</summary>
            <div className="mt-2 space-y-2">
              {cardsFromExperiments(data.experiments).map((c) => (
                <VariantCard key={c.id} card={withDecision(c)} onDecide={(id, d) => decide(id, d)} />
              ))}
            </div>
          </details>
        </Message>
      );
    }
    if (m.kind === "run") {
      const r = runs[m.runId];
      return r ? (
        <Message key={m.id} role="assistant" agentName={nameFor(m)}>
          <RunResult run={r} withDecision={withDecision} onDecide={decide} />
        </Message>
      ) : null;
    }
    return null;
  }

  return (
    <ChatLayout
      sidebar={sidebar}
      agents={agents}
      empty={msgs.length === 0}
      title={title}
      home={{
        greeting: "Which quiz should we test?",
        sub: `${title} · ${quiz.items.length} questions`,
        chips: (
          <>
            <Chip icon={<Target />} onClick={showAttack}>
              Attack my quiz
            </Chip>
            <Chip icon={<Globe />} onClick={() => void checkLeaks()}>
              Is any of this online?
            </Chip>
            {data.experiments.length ? (
              <Chip icon={<GitBranch />} onClick={() => handle("show me the experiment tree")}>
                Experiment tree
              </Chip>
            ) : null}
            <Chip icon={<History />} onClick={() => handle("show what a student saw")}>
              Show what a student saw
            </Chip>
            <Chip icon={<Download />} onClick={() => void exportCanvas()}>
              Export to Canvas
            </Chip>
            <Chip icon={<Link2 />} onClick={() => handle("connect canvas")}>
              Connect Canvas
            </Chip>
          </>
        ),
      }}
      composer={composer}
      composerNote={sourceNote}
    >
      <Thread>
        {msgs.map(renderMsg)}
        {decideError ? <p className="text-sm text-rejected">{decideError}</p> : null}
      </Thread>
    </ChatLayout>
  );
}

/** Agents may use **bold** (and nothing else); render it without a Markdown library. */
function withBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>,
  );
}

function Actions({ actions }: { actions: Action[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.map((a) => (
        <PillButton key={a.label} variant={a.primary ? "primary" : "secondary"} onClick={a.run}>
          {a.label}
        </PillButton>
      ))}
    </div>
  );
}

function AttackSummary({ data }: { data: StudioData }) {
  const items = data.quiz?.items ?? [];
  if (!data.solveRates.length) return <p>No agent has taken this quiz yet, so there are no results to show.</p>;
  const a = data.attack;
  const perQ = a ? Math.round(a.itemRuns / Math.max(1, items.length)) : 0;
  return (
    <>
      {a ? (
        <p>
          A browser agent took the quiz {perQ} time{perQ === 1 ? "" : "s"} and got{" "}
          <span className="font-medium">
            {a.itemCorrect} of {a.itemRuns}
          </span>{" "}
          answers right ({pct(a.accuracy)}).
        </p>
      ) : null}
      <div className="mt-3 overflow-hidden rounded-2xl border border-border">
        <ul className="divide-y divide-border">
          {items.map((it) => {
            const r = data.solveRates.find((s) => s.itemId === it.id);
            return (
              <li key={it.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-7 shrink-0 font-medium">Q{qNum(it.id)}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{it.stem}</span>
                {r ? (
                  <span className={`num shrink-0 text-xs ${r.agentSolvable ? "font-medium text-agent" : "text-muted-foreground"}`}>
                    {r.correct}/{r.runs} solved
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">not tried</span>
                )}
              </li>
            );
          })}
        </ul>
        {a ? (
          <p className="border-t border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
            {a.models.map((m) => m.replace("|", " on ")).join(", ")} · 95% CI <span className="num">{pct(a.ci95[0])} to {pct(a.ci95[1])}</span>
            {perQ < 3 ? " · small sample" : ""}
          </p>
        ) : null}
      </div>
    </>
  );
}

function RunResult({ run, withDecision, onDecide }: { run: RunState; withDecision: (c: Card) => Card; onDecide: (id: string, d: Decision, runId?: string) => Promise<void> }) {
  const cards = run.order.map((id) => withDecision(run.cards[id]!));
  const exps = cards.map(cardToExperiment).filter((e): e is NonNullable<typeof e> => e != null);
  const items = [...new Set(exps.map((e) => e.itemId))];
  const count = (...s: Card["status"][]) => cards.filter((c) => s.includes(c.status)).length;
  const busy = AGENT_ORDER.map((n) => run.agents[n]).find((a) => a.status === "working" || a.status === "thinking");
  return (
    <>
      {run.label ? <p className="text-sm text-muted-foreground">{run.label}</p> : null}
      {items.map((itemId) => (
        <div key={itemId} className="mt-3">
          <RaceCard
            data={buildRace(itemId, exps, null, null)}
            onMerge={run.mode === "replay" ? undefined : (id) => onDecide(id, "approve", run.awaiting?.includes(id) ? run.runId : undefined)}
          />
        </div>
      ))}
      {cards.length ? (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">Show the versions</summary>
          <div className="mt-2 space-y-2">
          {cards.map((c) => (
            <VariantCard
              key={c.id}
              card={c}
              waiting={run.awaiting?.includes(c.id)}
              onDecide={run.mode === "replay" ? undefined : (id, d) => onDecide(id, d, run.awaiting?.includes(id) ? run.runId : undefined)}
            />
          ))}
          </div>
        </details>
      ) : null}
      {run.running ? (
        <div className="mt-3">
          <Thinking label={busy ? `${busy.name}: ${busy.activity}` : "Starting"} />
        </div>
      ) : run.finished ? (
        <p className="mt-3">
          {cards.length} variant{cards.length === 1 ? "" : "s"}: {count("verified", "approved")} verified, {count("rejected")} rejected, {count("unverified")} not verified.
          {run.finished.message ? <span className="text-muted-foreground"> {run.finished.message}</span> : null}
        </p>
      ) : null}
    </>
  );
}

/** Race cards from the server (live Neon branch list + same-model baseline). */
function SavedRaces({ itemIds, onMerge }: { itemIds: string[]; onMerge: (id: string) => Promise<void> }) {
  const [races, setRaces] = useState<RaceData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all(itemIds.map((id) => fetch(`/studio/api/race?item=${encodeURIComponent(id)}`).then((r) => (r.ok ? (r.json() as Promise<RaceData>) : Promise.reject(new Error(String(r.status)))))))
      .then((rs) => live && setRaces(rs))
      .catch(() => live && setError("Couldn't load the races."));
    return () => {
      live = false;
    };
  }, [itemIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="mt-2 text-sm text-muted-foreground">{error}</p>;
  if (!races) return <div className="mt-3"><Thinking label="Loading the races from Neon" /></div>;
  return (
    <div className="mt-3 space-y-3">
      {races.map((r) => (
        <RaceCard key={r.itemId} data={r} onMerge={onMerge} />
      ))}
    </div>
  );
}

function TreeLoader({ quizId }: { quizId: string }) {
  const [tree, setTree] = useState<TreeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/studio/api/tree?quiz=${encodeURIComponent(quizId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<TreeData>) : Promise.reject(new Error(String(r.status)))))
      .then((t) => live && setTree(t))
      .catch(() => live && setError("Couldn't load the experiment tree."));
    return () => {
      live = false;
    };
  }, [quizId]);
  if (error) return <p className="text-sm text-muted-foreground">{error}</p>;
  if (!tree) return <Thinking label="Reading branches from Neon" />;
  return <TreeCard data={tree} />;
}
