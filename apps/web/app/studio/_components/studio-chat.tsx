"use client";
// Studio as a conversation (owner: B), on D's chat shell. No LLM behind the composer: it maps
// plain requests to actions (attack results, rewrite, replay, import), so it spends no quota.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Download, FileUp, GitBranch, Globe, History, Link2, Target } from "lucide-react";
import { CanvasCard } from "./canvas-card";
import { CourseScanCard } from "./course-scan-card";
import { replayCookieOn, studioFetch, syncReplayCookie } from "../_lib/replay-client";
import { AppealPicker } from "./appeal-picker";
import { ObjectiveConfirm } from "./objective-confirm";
import { NeonStatus } from "./neon-status";
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
type LeakScanView = { radar: LeakRadarData; online: number; total: number; searched: number; fromCache: number; queries: number; queryErrors: number };

type Msg =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; agent?: string; kind: "text"; text: string; actions?: Action[] }
  | { id: string; role: "assistant"; agent?: string; kind: "attack" }
  | { id: string; role: "assistant"; agent?: string; kind: "saved" }
  | { id: string; role: "assistant"; agent?: string; kind: "run"; runId: string }
  | { id: string; role: "assistant"; agent?: string; kind: "import" }
  | { id: string; role: "assistant"; agent?: string; kind: "leaks"; text: string; radar: LeakRadarData | null; done: boolean; error?: string }
  | { id: string; role: "assistant"; agent?: string; kind: "scan"; quizId: string; quizTitle: string; result: LeakScanView | null; error?: string; replayed?: string }
  | { id: string; role: "assistant"; agent?: string; kind: "tree" }
  | { id: string; role: "assistant"; agent?: string; kind: "canvas" }
  | { id: string; role: "assistant"; agent?: string; kind: "coursescan" }
  | { id: string; role: "assistant"; agent?: string; kind: "appeal" }
  | { id: string; role: "assistant"; agent?: string; kind: "objective"; quizId: string; itemId: string; label: string };

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
  const router = useRouter();

  // Cards that live in the URL (?view=tree | race&item= | appeal&attempt= | attack): opening such a URL renders
  // the card (re-fetched, replay-aware), refresh and deep links work, and Back returns to the plain studio.
  const sp = useSearchParams();
  const view = sp.get("view");
  const viewItem = sp.get("item");
  const viewAttempt = sp.get("attempt");

  const quiz = data.quiz;
  const title = quiz ? displayTitle(quiz.title) : "Studio";
  const solvable = useMemo(() => data.solveRates.filter((r) => r.agentSolvable), [data.solveRates]);

  const push = useCallback((m: Msg) => setMsgs((ms) => [...ms, m]), []);
  const say = useCallback(
    (text: string, opts: { agent?: string; actions?: Action[] } = {}) => push({ id: nid(), role: "assistant", kind: "text", text, ...opts }),
    [push],
  );
  useEffect(() => () => sourceRef.current?.close(), []);

  // Demo resilience: ?replay=1 turns replay mode on (cookie); replayed responses raise a badge.
  const [replayAt, setReplayAt] = useState<string | null>(null);
  // The cookie is external state: read it with useSyncExternalStore (false on the server).
  const replayMode = useSyncExternalStore(
    (cb) => {
      window.addEventListener("studio:replay-mode", cb);
      return () => window.removeEventListener("studio:replay-mode", cb);
    },
    () => replayCookieOn(),
    () => false,
  );
  useEffect(() => {
    syncReplayCookie();
    window.dispatchEvent(new Event("studio:replay-mode"));
    const on = (e: Event) => setReplayAt((e as CustomEvent<{ recordedAt: string }>).detail.recordedAt);
    window.addEventListener("studio:replay", on);
    return () => window.removeEventListener("studio:replay", on);
  }, []);

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
    (itemIds: string[], attack: boolean) => startRun(`mode=live&quiz=${encodeURIComponent(quiz?.id ?? "sample-stats")}&items=${itemIds.join(",")}&n=2&attack=${attack ? 1 : 0}`),
    [quiz?.id, startRun],
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

  const viewHref = useCallback(
    (v: "tree" | "race" | "appeal" | "attack", extra: Record<string, string> = {}) =>
      `/studio?${new URLSearchParams({ ...(quiz ? { quiz: quiz.id } : {}), view: v, ...extra }).toString()}`,
    [quiz],
  );
  const openView = useCallback(
    (v: "tree" | "race" | "appeal" | "attack", extra: Record<string, string> = {}) => router.push(viewHref(v, extra), { scroll: false }),
    [router, viewHref],
  );
  const showAttack = useCallback(() => openView("attack"), [openView]);
  // Shown under the attack card (part of the URL card, so Back removes it too).
  const attackNote = solvable.length
    ? `Agents can answer ${solvable.length} of ${quiz?.items.length ?? 0} questions. I can write new versions that keep the same answer and skill and aren't already online, so copied answer keys stop working. In our tests agents still solve reasonable rewrites, so for these questions the think-aloud check is what shows real understanding.`
    : null;

  // After any import: open the imported quiz and scan it for leaks right away.
  const openAndScan = useCallback((quizId: string) => router.push(`/studio?quiz=${encodeURIComponent(quizId)}&check=online`), [router]);
  const importedActions = useCallback(
    (quizId: string): Action[] => [
      { label: "Check which are already online", primary: true, run: () => openAndScan(quizId) },
      { label: "Open it here", run: () => router.push(`/studio?quiz=${encodeURIComponent(quizId)}`) },
    ],
    [openAndScan, router],
  );

  const importQuiz = useCallback(
    async (markdown: string) => {
      push({ id: nid(), role: "user", text: "Imported a quiz from Markdown" });
      const res = await fetch("/studio/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markdown }) });
      const body = (await res.json()) as { quizId?: string; message?: string; error?: string };
      say(res.ok ? `${body.message ?? "Imported."} Saved as ${body.quizId}.` : (body.error ?? "Import failed."), res.ok && body.quizId ? { actions: importedActions(body.quizId) } : {});
    },
    [importedActions, push, say],
  );

  // Leak scout (Mastra agent behind /api/agents): streams AgentEvents to the panel, findings -> D's LeakRadar.
  const checkLeaks = useCallback(async (fresh = false) => {
    if (!quiz) return;
    push({ id: nid(), role: "user", text: fresh ? "Which of these imported questions are already online?" : "Is any of this quiz already online?" });
    const id = nid();
    push({ id, role: "assistant", agent: "Leak scout", kind: "leaks", text: "", radar: null, done: false });
    const patch = (p: Partial<Extract<Msg, { kind: "leaks" }>>) => setMsgs((ms) => ms.map((m) => (m.id === id ? ({ ...m, ...p } as Msg) : m)));
    try {
      const res = await studioFetch("/api/agents/leak-scout/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: fresh
            ? `I just imported quiz "${quiz.id}" (quizId ${quiz.id}). Nothing is on record for it yet: search the web now for every question and tell me which are already online.`
            : `Is anything from my quiz "${quiz.id}" (quizId ${quiz.id}) already online?`,
        }),
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
          if (o.type === "replay") {
            window.dispatchEvent(new CustomEvent("studio:replay", { detail: { recordedAt: (o as { recordedAt?: string }).recordedAt } }));
            continue;
          }
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

  // ?check=online (set by openAndScan): run the fresh leak scan once for the quiz that just opened.
  const scannedRef = useRef(false);
  useEffect(() => {
    if (scannedRef.current || !quiz) return;
    const u = new URL(window.location.href);
    if (u.searchParams.get("check") !== "online" || u.searchParams.get("quiz") !== quiz.id) return;
    // Deferred (not setState inside the effect body); the ref is set when it actually runs, so a
    // StrictMode mount/unmount/mount still scans exactly once.
    const t = setTimeout(() => {
      scannedRef.current = true;
      u.searchParams.delete("check");
      window.history.replaceState(null, "", u.toString());
      void checkLeaks(true);
    }, 0);
    return () => clearTimeout(t);
  }, [checkLeaks, quiz]);

  // Canvas import -> leak scan -> rewrite: scan every question (at most 2 searches each, cached), then offer a
  // one-click rewrite for each question found online.
  const scanQuiz = useCallback(
    async (quizId: string, quizTitle: string) => {
      const id = nid();
      push({ id, role: "assistant", agent: "Leak scout", kind: "scan", quizId, quizTitle, result: null });
      const patch = (p: Partial<Extract<Msg, { kind: "scan" }>>) => setMsgs((ms) => ms.map((m) => (m.id === id ? ({ ...m, ...p } as Msg) : m)));
      try {
        const res = await studioFetch("/studio/api/leakscan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quizId }) });
        const b = (await res.json().catch(() => ({}))) as LeakScanView & { error?: string };
        if (!res.ok) return patch({ error: b.error ?? `Leak scan unavailable (${res.status}).` });
        patch({ result: b, replayed: res.headers.get("X-Studio-Replay") ?? undefined });
      } catch {
        patch({ error: "Lost the connection to the leak scan." });
      }
    },
    [push],
  );
  const writeNewVersion = useCallback(
    (quizId: string, itemId: string, label: string) => {
      // The objective is confirmed first (imports only guess it); ObjectiveConfirm starts the run.
      push({ id: nid(), role: "user", text: `Write a new version of ${label}` });
      push({ id: nid(), role: "assistant", agent: "Rewriter", kind: "objective", quizId, itemId, label });
    },
    [push],
  );
  const runRewrite = useCallback(
    (quizId: string, itemId: string) => startRun(`mode=live&quiz=${encodeURIComponent(quizId)}&items=${encodeURIComponent(itemId)}&n=2&attack=0&leaked=1`),
    [startRun],
  );

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
      say(`Imported "${r.title}" from Canvas: ${r.items} question${r.items === 1 ? "" : "s"}, saved as ${r.quizId}.${skipped} Now checking each question against the open web.`, r.quizId ? { actions: [{ label: "Open it here", run: () => router.push(`/studio?quiz=${encodeURIComponent(r.quizId!)}`) }] } : {});
      if (r.quizId) void scanQuiz(r.quizId, r.title ?? r.quizId);
    },
    [push, router, say, scanQuiz],
  );
  const exportCanvas = useCallback(async () => {
    if (!quiz) return;
    push({ id: nid(), role: "user", text: "Export this quiz for Canvas" });
    const res = await studioFetch(`/studio/api/qti/export?quiz=${encodeURIComponent(quiz.id)}`);
    if (!res.ok) {
      const r = (await res.json().catch(() => ({}))) as { error?: string };
      return say(r.error ?? "Export failed.");
    }
    const summary = JSON.parse(res.headers.get("X-Export-Summary") ?? "{}") as { exported?: number; variants?: string[] };
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    const file = `${quiz.id}-canvas.imscc`;
    a.download = file;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    const n = summary.variants?.length ?? 0;
    say(
      `Downloaded ${file} with ${summary.exported ?? "the"} questions${n ? `, including ${n} approved rewrite${n === 1 ? "" : "s"}` : " (no approved rewrites yet, so these are the originals)"}. In Canvas: Settings, Import Course Content, "Canvas Course Export Package", then Select specific content, Quizzes.`,
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
      if (/what .*saw|appeal|time.?travel/i.test(t)) return openView("appeal");
      if (/course\s*(web)?\s*site|scan my course/i.test(t)) return push({ id: nid(), role: "assistant", agent: "Leak scout", kind: "coursescan" });
      if (/connect\s+canvas|import.*canvas|canvas.*course/i.test(t)) return push({ id: nid(), role: "assistant", kind: "canvas" });
      if (/export|canvas/i.test(t)) return void exportCanvas();
      if (/tree|branch|neon/i.test(t)) return openView("tree");
      if (/saved|past|previous/i.test(t) && data.experiments.length) return push({ id: nid(), role: "assistant", agent: "Rewriter", kind: "saved" });
      const qs = [...t.matchAll(/\bq(\d+)\b/gi)].map((m) => `${quiz?.id}-q${m[1]}`).filter((id) => quiz?.items.some((i) => i.id === id));
      if (/rewrite|transform|variant|fix|harden/i.test(t)) return offerRewrite(qs.length ? qs : solvable.map((s) => s.itemId));
      say("I can show how agents did on this quiz, rewrite the questions they answer, replay a recorded rewrite, or import a quiz you paste in Markdown.", {
        actions: [{ label: "Attack my quiz", primary: true, run: showAttack }],
      });
    },
    [checkLeaks, data.experiments.length, exportCanvas, importQuiz, offerRewrite, openView, push, quiz, replay, say, showAttack, solvable],
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
        accept=".zip,.imscc,application/zip"
        className="hidden"
        aria-label="Canvas export (.zip or .imscc)"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void importCanvas(f);
        }}
      />
    </>
  );
  const replayNote = replayAt
    ? `Replaying a recorded run from ${new Date(replayAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}${replayMode ? " (replay mode)" : " (a service was slow or unreachable)"}.`
    : replayMode
      ? "Replay mode is on: results come from recorded runs."
      : null;
  const sourceNote =
    data.quizSource === "neon" && data.solveRatesMeasured
      ? `Agent results: ${data.attack?.itemRuns ?? 0} real answers.`
      : "Some of this view uses sample data.";

  if (!quiz) {
    return (
      <ChatLayout
        sidebar={sidebar}
        agents={agents}
        panelFooter={<NeonStatus />}
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

  // The card named by the URL (?view=...), rendered after the thread. Not stored in msgs, so Back removes it.
  const plainHref = `/studio?quiz=${encodeURIComponent(quiz.id)}`;
  const closeLink = (
    <Link href={plainHref} scroll={false} className="mt-3 inline-block text-xs text-muted-foreground underline-offset-2 hover:underline">
      Close
    </Link>
  );
  const raceItem = viewItem && quiz.items.some((i) => i.id === viewItem) ? viewItem : null;
  const urlCard =
    view === "attack" ? (
      <Message key="view-attack" role="assistant" agentName="Quiz checker">
        <AttackSummary data={data} />
        {attackNote ? (
          <>
            <p className="mt-3">{attackNote}</p>
            <Actions actions={[{ label: "Write new versions", primary: true, run: () => offerRewrite(solvable.map((x) => x.itemId)) }]} />
          </>
        ) : null}
        {closeLink}
      </Message>
    ) : view === "tree" ? (
      <Message key="view-tree" role="assistant" agentName="Rewriter">
        <p>Here is every rewrite tried on this quiz, as branches of the quiz database:</p>
        <div className="mt-3">
          <TreeLoader quizId={quiz.id} />
        </div>
        {data.experiments.length ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Open a race:{" "}
            {[...new Set(data.experiments.map((e) => e.itemId))].map((id, i) => (
              <span key={id}>
                {i ? ", " : ""}
                <Link href={viewHref("race", { item: id })} scroll={false} className="underline underline-offset-2">
                  Q{qNum(id)}
                </Link>
              </span>
            ))}
          </p>
        ) : null}
        {closeLink}
      </Message>
    ) : view === "race" ? (
      <Message key={`view-race-${viewItem}`} role="assistant" agentName="Rewriter">
        {raceItem ? (
          <>
            <p>The branch race for Q{qNum(raceItem)}:</p>
            <SavedRaces itemIds={[raceItem]} onMerge={(id) => decide(id, "approve")} />
          </>
        ) : (
          <p className="text-muted-foreground">That question isn&apos;t in this quiz.</p>
        )}
        {closeLink}
      </Message>
    ) : view === "appeal" ? (
      <Message key="view-appeal" role="assistant">
        <p>Pick an attempt. I&apos;ll branch the database at the moment it started and show the quiz exactly as that student saw it.</p>
        <div className="mt-3">
          <AppealPicker quizId={quiz.id} attemptId={viewAttempt} onOpen={(attemptId) => openView("appeal", { attempt: attemptId })} />
        </div>
        {closeLink}
      </Message>
    ) : null;

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
    if (m.kind === "objective") {
      return (
        <Message key={m.id} role="assistant" agentName={nameFor(m)}>
          <ObjectiveConfirm itemId={m.itemId} label={m.label} onConfirmed={() => runRewrite(m.quizId, m.itemId)} />
        </Message>
      );
    }
    if (m.kind === "scan") {
      const r = m.result;
      const leaked = r ? r.radar.items.filter((i) => i.hits.some((h) => !h.partial)) : [];
      return (
        <Message key={m.id} role="assistant" agentName={nameFor(m)}>
          {m.error ? (
            <p className="text-muted-foreground">Couldn&apos;t check the web for {m.quizTitle}: {m.error}</p>
          ) : !r ? (
            <Thinking label={`Searching the web for each question in ${m.quizTitle} (at most 2 searches per question)`} />
          ) : (
            <>
              <p>
                <strong>
                  {r.online} of your {r.total} question{r.total === 1 ? "" : "s"} {r.online === 1 ? "is" : "are"} already online.
                </strong>{" "}
                {r.online
                  ? "Students can copy those answers. A rewrite keeps the skill and changes what's being asked, so a copied answer won't match."
                  : "Nothing turned up for these questions."}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {r.searched
                  ? `${r.queries} web search${r.queries === 1 ? "" : "es"} for ${r.searched} question${r.searched === 1 ? "" : "s"}${r.fromCache ? `; ${r.fromCache} reused from a scan in the last 24 h` : ""}${r.queryErrors ? `; ${r.queryErrors} failed` : ""}.`
                  : `No new web searches: all ${r.fromCache} questions were scanned in the last 24 h.`}{" "}
                Exact phrases only, at most 2 searches per question.
              </p>
              <div className="mt-3">
                <LeakRadar data={r.radar} />
              </div>
              {leaked.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {leaked.map((i) => (
                    <PillButton key={i.itemId} variant="primary" onClick={() => writeNewVersion(m.quizId, i.itemId, i.label)}>
                      Write a new version of {i.label}
                    </PillButton>
                  ))}
                </div>
              ) : null}
            </>
          )}
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
    if (m.kind === "coursescan") {
      return (
        <Message key={m.id} role="assistant" agentName={nameFor(m)}>
          <CourseScanCard onRewrite={writeNewVersion} />
        </Message>
      );
    }
    if (m.kind === "canvas") {
      return (
        <Message key={m.id} role="assistant" agentName={nameFor(m)}>
          <CanvasCard
            onImported={(r) =>
              say(`Imported "${r.title}" from Canvas: ${r.items} question${r.items === 1 ? "" : "s"}${r.skipped?.length ? `, ${r.skipped.length} skipped (unsupported types)` : ""}.`, {
                actions: importedActions(r.quizId),
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
      panelFooter={<NeonStatus />}
      empty={msgs.length === 0 && !urlCard}
      title={title}
      home={{
        greeting: "Which quiz should we test?",
        sub: `${title} · ${quiz.items.length} questions${replayMode ? " · replay mode: results come from recorded runs" : ""}`,
        chips: (
          <>
            <Chip icon={<Target />} onClick={showAttack}>
              Attack my quiz
            </Chip>
            <Chip icon={<Globe />} onClick={() => void checkLeaks()}>
              Is any of this online?
            </Chip>
            {data.experiments.length ? (
              <Chip icon={<GitBranch />} onClick={() => openView("tree")}>
                Experiment tree
              </Chip>
            ) : null}
            <Chip icon={<History />} onClick={() => openView("appeal")}>
              Show what a student saw
            </Chip>
            <Chip icon={<Download />} onClick={() => void exportCanvas()}>
              Export to Canvas
            </Chip>
            <Chip icon={<Link2 />} onClick={() => handle("connect canvas")}>
              Connect Canvas
            </Chip>
            <Chip icon={<Globe />} onClick={() => handle("scan my course website")}>
              Scan my course website
            </Chip>
          </>
        ),
      }}
      composer={composer}
      composerNote={replayNote ? <span className="font-medium text-agent">{replayNote}</span> : sourceNote}
    >
      <Thread>
        {msgs.map(renderMsg)}
        {urlCard}
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
    Promise.all(itemIds.map((id) => studioFetch(`/studio/api/race?item=${encodeURIComponent(id)}`).then((r) => (r.ok ? (r.json() as Promise<RaceData>) : Promise.reject(new Error(String(r.status)))))))
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
    studioFetch(`/studio/api/tree?quiz=${encodeURIComponent(quizId)}`)
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
