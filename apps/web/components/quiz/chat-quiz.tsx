"use client";
// The quiz as a chat thread: tutor messages, inline question cards, and the think-aloud probe in the
// thread and composer. Logic lives here; the visual primitives are D's (swap-in points marked "UI").
//
// Stable DOM for A's agents and D's detection (keep these ids!):
//   #start-practice #start-graded #quiz-item-form #item-<itemId> #choice-<x> #answer-input #submit-answer
//   #item-feedback #next-item #finish-quiz #quiz-score
//   #probe[data-step] #probe-type #probe-voice #probe-skip #probe-consent-check #probe-consent-continue
//   #probe-consent-type #confidence-before-N #probe-begin #probe-opening #probe-explanation
//   #probe-submit-explanation #probe-start-over #probe-counterfactual #probe-cf-answer #probe-submit-cf
//   #confidence-after-N #probe-finish #probe-done #probe-continue #probe-voice-done #probe-switch-typing
// Only the ACTIVE step renders these ids; finished steps become plain text, so ids stay unique.
import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, FlaskConical, LogOut } from "lucide-react";
import { ConversationProvider } from "@elevenlabs/react";
import { ChatLayout, Chip, Composer, Message, PillButton, QuestionCard, Thinking, Thread, type AgentInfo } from "@/components/ui/chat";
import { useTelemetry } from "@/lib/telemetry/use-telemetry";
import { emitAgentStatus } from "@/lib/telemetry/agent-status";
import { agentTurn, type Source } from "@/lib/agents/agent-turn";
import { trackTextSignals, type TextSignals } from "@/lib/telemetry/text-signals";
import { ConfidencePicker, ExplainBox, ThinkAloudScene, type ThinkAloudStep } from "@/components/ui/quiz";
import { useVoiceProbe, type ProbePhase, type VoiceResult } from "@/components/probe/use-voice-probe";
import { ItemView, type ItemResult } from "./item-view";
import type { Answer, Mode, PublicItem, PublicQuiz } from "./types";
import { markAnswered, rememberSession, useSessionGroups } from "./sessions";

type Phase =
  | "home"
  | "pick"
  | "intro"
  | "question"
  | "checking"
  | "feedback"
  | "probe_choice"
  | "probe_consent"
  | "probe_before"
  | "probe_explain"
  | "probe_cf_loading"
  | "probe_cf"
  | "probe_voice"
  | "probe_after"
  | "probe_done"
  | "done";

type Entry =
  | { id: number; who: "tutor" | "student"; text: string; agent?: string; sources?: Source[]; note?: string }
  // An answered question, kept in the thread (locked, no ids) so the student sees what they chose.
  | { id: number; who: "card"; itemId: string; index: number; answer: Answer; mode: Mode; result?: ItemResult };

// Clock for event handlers (wrapped so the React compiler doesn't mistake handler code for render code).
const now = () => performance.now();

function isEmpty(a: Answer) {
  return Array.isArray(a) ? a.length === 0 : a.trim() === "";
}
// Minimal inline Markdown for agent replies: **bold**, `code`, and line breaks. No single-* italics:
// math like n*x^(n-1) must stay intact. No HTML injection.
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\n)/g);
  return (
    <>
      {parts.map((p, i) =>
        p === "\n" ? (
          <br key={i} />
        ) : p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? (
          <code key={i} className="rounded bg-muted px-1 text-[0.9em]">{p.slice(1, -1)}</code>
        ) : (
          p
        ),
      )}
    </>
  );
}

function choiceText(item: PublicItem, a: Answer) {
  const ids = Array.isArray(a) ? a : [a];
  if (!item.choices) return String(a);
  return ids.map((id) => { const i = item.choices!.findIndex((c) => c.id === id); return `${"ABCDEFGH"[i] ?? id} · ${item.choices![i]?.text ?? ""}`; }).join(", ");
}

const qs = (n: number) => `${n} question${n === 1 ? "" : "s"}`;

// Friendly in-thread names for agent tool steps (the raw labels still go to the Agents panel).
const TOOL_LABEL: Record<string, string> = {
  todaysPractice: "Tutor is building a practice question from today's official data",
  checkPracticeAnswer: "Tutor is checking your answer",
  checkAnswer: "Tutor is checking your answer",
  explainResult: "Tutor is writing an explanation",
  startQuiz: "Tutor is looking at the quiz",
};

// Calm practice feedback: what the answer is and what the question was about. Not color-only.
function feedbackText(item: PublicItem, correct: boolean, key: string[] | null) {
  const why = item.objective ? ` The skill here: ${item.objective.replace(/\.$/, "")}.` : "";
  if (correct) return `That's right.${why}`;
  const ans = key?.length ? ` The answer is ${item.choices ? key.map((k) => `${k.toUpperCase()}) ${item.choices!.find((c) => c.id === k)?.text ?? ""}`).join(", ") : key.join(", ")}.` : "";
  return `Not quite.${ans}${why} Worth a second look before the graded quiz.`;
}

// An answered question kept in the thread: locked, no ids, result shown once known.
function AnsweredCard({ entry, quiz }: { entry: Extract<Entry, { who: "card" }>; quiz: PublicQuiz }) {
  const it = quiz.items.find((i) => i.id === entry.itemId);
  if (!it) return null;
  return (
    <QuestionCard label={`Question ${entry.index + 1} of ${quiz.items.length} · ${entry.mode === "practice" ? "Practice" : "Graded"}`} stem={it.stem} footer={<span />}>
      <ItemView item={it} value={entry.answer} locked hideStem result={entry.result} />
    </QuestionCard>
  );
}

async function post<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

interface ChatQuizProps {
  quizzes: PublicQuiz[];
  /** Quiz route: preselect this quiz and open at the tutor's intro. */
  initialQuizId?: string;
  suggestedMode?: Mode;
  student?: string;
  /** Home page: start in the empty state (greeting, centered composer, chips). */
  startEmpty?: boolean;
  /** Signed-in viewer (name and role only; never the email). */
  viewer?: { name: string; role: "student" | "professor" } | null;
}

const AGENTS: AgentInfo[] = [
  { id: "tutor", name: "Tutor", status: "ready when you are", state: "idle" },
  { id: "explain-coach", name: "Explain coach", status: "joins for think-alouds", state: "idle" },
  { id: "researcher", name: "Researcher", status: "finds sources when you ask", state: "idle" },
  { id: "judge-panel", name: "Judge panel", status: "reviews explanations later", state: "idle" },
];

export function ChatQuiz(props: ChatQuizProps) {
  return (
    <ConversationProvider>
      <ChatQuizInner {...props} />
    </ConversationProvider>
  );
}

// Match free text like "help me with derivatives" to a quiz by title and objectives.
function matchQuiz(quizzes: PublicQuiz[], text: string): PublicQuiz | null {
  const words = text.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  let best: { q: PublicQuiz; score: number } | null = null;
  for (const q of quizzes) {
    const hay = `${q.title} ${q.items.map((i) => i.objective).join(" ")}`.toLowerCase();
    const score = words.filter((w) => hay.includes(w.replace(/s$/, ""))).length;
    if (score > 0 && (!best || score > best.score)) best = { q, score };
  }
  return best?.q ?? null;
}

function ChatQuizInner({ quizzes, initialQuizId, suggestedMode = "practice", student, startEmpty = false, viewer }: ChatQuizProps) {
  const [phase, setPhase] = useState<Phase>(startEmpty ? "home" : "intro");
  const [quizId, setQuizId] = useState(initialQuizId ?? quizzes[0]?.id);
  const quiz = quizzes.find((q) => q.id === quizId) ?? quizzes[0];
  const sessionGroups = useSessionGroups();
  const [mode, setMode] = useState<Mode>(suggestedMode);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<Answer>("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [lastKey, setLastKey] = useState<string[] | null>(null);
  const [tutorLive, setTutorLive] = useState<string | null>(null); // streaming agent reply
  const [figureTexts, setFigureTexts] = useState<Record<string, string>>({}); // accessible versions shown
  // Typed-input signals per probe textarea (evidence for the professor, never a verdict).
  const trackers = useRef<Record<string, ReturnType<typeof trackTextSignals>>>({});
  const signals = useRef<Record<string, TextSignals>>({});
  const attachTracker = (field: "explanation" | "followup", el: HTMLTextAreaElement | null) => {
    if (el && !trackers.current[field]) trackers.current[field] = trackTextSignals(el);
    if (!el && trackers.current[field]) {
      signals.current[field] = trackers.current[field].read();
      trackers.current[field].stop();
      delete trackers.current[field];
    }
  };
  const explanationRef = useCallback((el: HTMLTextAreaElement | null) => attachTracker("explanation", el), []);
  const followupRef = useCallback((el: HTMLTextAreaElement | null) => attachTracker("followup", el), []);
  const readSignals = (field: "explanation" | "followup") => {
    if (trackers.current[field]) signals.current[field] = trackers.current[field].read();
  };
  const [liveAgent, setLiveAgent] = useState<"tutor" | "researcher">("tutor");
  const [liveStep, setLiveStep] = useState<string | null>(null); // e.g. "Searching the web (Bright Data)"
  const [lastCardId, setLastCardId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ score: number; total: number; results: { itemId: string; answered: boolean; correct: boolean }[] } | null>(null);
  // probe state
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [consent, setConsent] = useState(false);
  const [channel, setChannel] = useState<"typed" | "voice">("typed");
  const [before, setBefore] = useState<number | null>(null);
  const [after, setAfter] = useState<number | null>(null);
  const [probeId, setProbeId] = useState<string | null>(null);
  const [opening, setOpening] = useState("");
  const [cfPrompt, setCfPrompt] = useState("");
  const [draft, setDraft] = useState("");
  const [explanation, setExplanation] = useState("");
  const [cfAnswer, setCfAnswer] = useState("");
  const [retried, setRetried] = useState(false);
  const [voiceLatency, setVoiceLatency] = useState<number | undefined>();
  const shownAt = useRef(0);
  const nextId = useRef(1);
  const t0 = useRef(0);
  const marks = useRef<Partial<Record<ProbePhase, number>>>({});
  const probeIdRef = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const item = quiz.items[index];
  const isLast = index === quiz.items.length - 1;
  const telemetry = useTelemetry(attemptId, item?.id, phase !== "home" && phase !== "intro" && phase !== "done");

  const say = useCallback((who: "tutor" | "student", text: string, extra: { agent?: string; sources?: Source[]; note?: string } = {}) => {
    setEntries((e) => [...e, { id: nextId.current++, who, text, ...extra }]);
  }, []);

  useEffect(() => {
    fetch("/api/probes")
      .then((r) => r.json())
      .then((d) => setVoiceAvailable(Boolean(d.voiceAvailable)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries.length, phase]);

  // ---- probe timing (D's probe_latency view uses these exact phase names and wall-clock ts) ----
  const mark = useCallback((phaseName: ProbePhase) => {
    if (marks.current[phaseName] !== undefined || !probeIdRef.current) return;
    const at = now();
    marks.current[phaseName] = at;
    post(`/api/probes/${probeIdRef.current}/timing`, { phases: [{ phase: phaseName, ms: Math.round(at - t0.current), ts: new Date().toISOString() }] }).catch(() => {});
  }, []);

  // ---- quiz flow ----
  const start = async (m: Mode, chosen?: PublicQuiz) => {
    const target = chosen ?? quiz;
    setBusy(true);
    setError(null);
    try {
      const d = await post<{ attemptId: string }>("/api/attempts", { quizId: target.id, mode: m, studentPseudonym: student, itemIds: target.items.map((i) => i.id) });
      setQuizId(target.id);
      setMode(m);
      setAttemptId(d.attemptId);
      rememberSession({ id: d.attemptId, quizId: target.id, title: target.title, mode: m, startedAt: new Date().toISOString() });
      if (window.location.pathname !== `/quiz/${target.id}`) window.history.replaceState(null, "", `/quiz/${target.id}?mode=${m}`);
      say("student", m === "practice" ? "Let's practice." : "I'm ready for the graded quiz.");
      say(
        "tutor",
        m === "practice"
          ? `Great. ${qs(target.items.length)} on ${target.title}. After each one I'll tell you how it went. Sometimes I'll ask you to talk through your thinking. That's the part that makes it stick.`
          : `${qs(target.items.length)} on ${target.title}. You'll see your results at the end. Once or twice I'll ask you to explain your reasoning in your own words.`,
        { agent: "Tutor" },
      );
      setIndex(0);
      setAnswer("");
      shownAt.current = now();
      setPhase("question");
      emitAgentStatus("tutor", `presenting question 1 of ${target.items.length}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finishQuiz = async () => {
    if (!attemptId) return;
    emitAgentStatus("tutor", "adding up your results");
    const s = await post<NonNullable<typeof summary>>(`/api/attempts/${attemptId}/finish`, { itemIds: quiz.items.map((i) => i.id) });
    setSummary(s);
    setPhase("done");
    emitAgentStatus("tutor", "results ready", "done");
  };

  const nextQuestion = async () => {
    if (phase === "feedback" && lastCorrect !== null && item) say("tutor", feedbackText(item, lastCorrect, lastKey));
    if (isLast) return finishQuiz();
    setIndex((i) => i + 1);
    setAnswer("");
    setLastCorrect(null);
    shownAt.current = now();
    setPhase("question");
    telemetry.emit("answer", { type: "item_shown", index: index + 2 }, quiz.items[index + 1]?.id);
    emitAgentStatus("tutor", `presenting question ${index + 2} of ${quiz.items.length}`);
  };

  // Accommodation (CONTRACTS): the accessible version is never penalized; this item's think-aloud always runs.
  const requestAccessible = async () => {
    if (!attemptId || !item || figureTexts[item.id]) return;
    try {
      const d = await post<{ figureText: string }>(`/api/attempts/${attemptId}/accommodation`, { itemId: item.id });
      setFigureTexts((m) => ({ ...m, [item.id]: d.figureText }));
      telemetry.emit("focus", { type: "accommodation", accommodation: "figure_text", excludeFromDetection: true });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const changeAnswer = (v: Answer) => {
    setAnswer(v);
    telemetry.emit("answer", { type: "change", value: v, sinceShownMs: Math.round(now() - shownAt.current) });
  };

  const submitAnswer = async () => {
    if (!attemptId || !item || isEmpty(answer)) return;
    setBusy(true);
    setError(null);
    setPhase("checking");
    emitAgentStatus("tutor", "checking your answer");
    try {
      const seconds = Math.round(((now() - shownAt.current) / 1000) * 10) / 10;
      const d = await post<{ correct?: boolean; probe?: boolean; correctAnswer?: string[] }>(`/api/attempts/${attemptId}/responses`, { itemId: item.id, answer, seconds });
      telemetry.emit("answer", { type: "submit", value: answer, seconds });
      telemetry.flush();
      markAnswered(attemptId);
      emitAgentStatus("tutor", `answer ${index + 1} saved`, "done");
      // Keep the card in the thread, locked. In practice the result shows after any think-aloud.
      const cardId = nextId.current++;
      setEntries((e) => [...e, { id: cardId, who: "card", itemId: item.id, index, answer, mode }]);
      setLastCardId(cardId);
      if (mode === "practice") {
        setLastCorrect(Boolean(d.correct));
        setLastKey(d.correctAnswer ?? null);
        if (!d.probe) revealResult(cardId, Boolean(d.correct), d.correctAnswer);
      }
      if (d.probe) {
        // The think-aloud comes before any feedback, so knowing the result doesn't color the explanation.
        say("tutor", "Before I tell you how that went: quick think-aloud. Explaining your reasoning is one of the best ways to lock it in, and only your reasoning counts, never wording or accent.", { agent: "Explain coach" });
        emitAgentStatus("explain-coach", "starting a think-aloud");
        setBefore(null);
        setAfter(null);
        setConsent(false);
        setDraft("");
        setExplanation("");
        setCfPrompt("");
        setRetried(false);
        setProbeId(null);
        probeIdRef.current = null;
        signals.current = {};
        setPhase("probe_choice");
      } else if (mode === "practice") setPhase("feedback");
      else await nextQuestion();
    } catch (e) {
      setError((e as Error).message);
      setPhase("question");
    } finally {
      setBusy(false);
    }
  };

  // ---- probe flow ----
  const voice = useVoiceProbe({
    mark,
    onFinished: (r: VoiceResult) => {
      for (const l of r.lines) say(l.role === "agent" ? "tutor" : "student", l.text, l.role === "agent" ? { agent: "Explain coach" } : {});
      setVoiceLatency(r.counterfactualLatencyMs);
      if (r.conversationId && probeIdRef.current) post(`/api/probes/${probeIdRef.current}/voice/finish`, { conversationId: r.conversationId }).catch(() => {});
      say("tutor", "Thanks. Now that you've said it out loud, how sure are you?", { agent: "Explain coach" });
      setPhase("probe_after");
    },
  });

  const beginProbe = async () => {
    if (before === null || !attemptId || !item) return;
    setBusy(true);
    setError(null);
    say("student", `Confidence: ${before} of 7`);
    try {
      const d = await post<{ probeId: string; opening: string }>("/api/probes", { attemptId, itemId: item.id, confidenceBefore: before, mode: channel });
      setProbeId(d.probeId);
      probeIdRef.current = d.probeId;
      setOpening(d.opening);
      marks.current = {};
      t0.current = now();
      if (channel === "voice") {
        try {
          const v = await post<{ signedUrl: string; dynamicVariables: Record<string, string> }>(`/api/probes/${d.probeId}/voice`, { consent: true });
          voice.start({ probeId: d.probeId, ...v });
          setPhase("probe_voice");
          return;
        } catch (e) {
          say("tutor", `${(e as Error).message} Let's type it instead.`, { agent: "Explain coach" });
          setChannel("typed");
        }
      }
      setPhase("probe_explain");
      mark("prompt");
      emitAgentStatus("explain-coach", "waiting for your explanation", "idle");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const switchToTyping = () => {
    const r = voice.abandon();
    for (const l of r.lines) say(l.role === "agent" ? "tutor" : "student", l.text, l.role === "agent" ? { agent: "Explain coach" } : {});
    if (r.conversationId && probeIdRef.current) post(`/api/probes/${probeIdRef.current}`, { conversationId: r.conversationId, mode: "typed" }, "PATCH").catch(() => {});
    setChannel("typed");
    // The coach already asked the opening out loud; don't ask it twice.
    if (r.lines.some((l) => l.role === "agent")) setOpening("Go ahead and type it instead. Same question, your own words.");
    if (r.counterfactualPrompt) {
      setCfPrompt(r.counterfactualPrompt);
      setPhase("probe_cf");
    } else setPhase("probe_explain");
  };

  const submitExplanation = async () => {
    if (!probeId || !draft.trim()) return;
    readSignals("explanation");
    mark("speech_end");
    const text = draft.trim();
    setExplanation(text);
    say("tutor", opening, { agent: "Explain coach" });
    say("student", text);
    setDraft("");
    setPhase("probe_cf_loading");
    emitAgentStatus("explain-coach", "preparing a follow-up");
    try {
      const d = await post<{ prompt: string }>(`/api/probes/${probeId}/counterfactual`, { explanation: text });
      setCfPrompt(d.prompt);
      setPhase("probe_cf");
      emitAgentStatus("explain-coach", "waiting for your answer", "idle");
    } catch (e) {
      setError((e as Error).message);
      setPhase("probe_explain");
    }
  };

  const startOver = async () => {
    if (!probeId || retried) return;
    await post(`/api/probes/${probeId}`, { reset: true }, "PATCH").catch(() => {});
    setRetried(true);
    setDraft("");
    marks.current = {};
    t0.current = now();
    mark("prompt");
  };

  const submitCounterfactual = () => {
    if (!draft.trim()) return;
    readSignals("followup");
    mark("cf_speech_end");
    setCfAnswer(draft.trim());
    say("tutor", cfPrompt, { agent: "Explain coach" });
    say("student", draft.trim());
    setDraft("");
    setPhase("probe_after");
    say("tutor", "Now that you've explained it, how sure are you?", { agent: "Explain coach" });
  };

  const finishProbe = async () => {
    if (!probeId || after === null) return;
    setBusy(true);
    setError(null);
    const m = marks.current;
    const typedLatency = m.cf_prompt !== undefined && m.cf_speech_start !== undefined ? Math.round(m.cf_speech_start - m.cf_prompt) : undefined;
    try {
      await post(
        `/api/probes/${probeId}`,
        channel === "voice"
          ? { confidenceAfter: after, counterfactualLatencyMs: voiceLatency, retried }
          : {
              transcript: [`Unprompted: ${opening}`, `Student (typed): ${explanation}`, `Unprompted: ${cfPrompt}`, `Student (typed): ${cfAnswer}`].join("\n"),
              explanation,
              counterfactualAnswer: cfAnswer,
              confidenceAfter: after,
              counterfactualLatencyMs: typedLatency,
              retried,
              explainSignals: signals.current,
            },
        "PATCH",
      );
      say("student", `Confidence: ${after} of 7`);
      emitAgentStatus("explain-coach", "think-aloud saved", "done");
      emitAgentStatus("judge-panel", "explanation queued for review", "idle");
      setPhase("probe_done");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const probeContinue = () => {
    const dropped = before !== null && after !== null && after < before;
    say(
      "tutor",
      dropped ? "Your confidence moved after explaining. That's normal and useful: it points at exactly what to review." : "Thanks. Explaining it is what makes it stick.",
      { agent: "Explain coach" },
    );
    if (mode === "practice") {
      if (lastCardId !== null && lastCorrect !== null) revealResult(lastCardId, lastCorrect, lastKey ?? undefined);
      setPhase("feedback");
    } else nextQuestion();
  };

  // ---- composer (UI: swap for D's Composer; keep the ids) ----
  const composerFirstKey = () => {
    if (phase === "probe_explain") mark("speech_start");
    else if (phase === "probe_cf") mark("cf_speech_start");
  };

  useEffect(() => {
    if (phase === "probe_cf") mark("cf_prompt");
  }, [phase, mark]);

  const probeStep = phase.startsWith("probe_") ? phase.slice(6) : null;

  function revealResult(cardId: number, correct: boolean, key?: string[] | null) {
    setEntries((list) => list.map((x) => (x.id === cardId && x.who === "card" ? { ...x, result: { correct, correctIds: key ?? undefined } } : x)));
  }

  // Free text outside a probe step: the tutor's open chat arrives with B's agent API. Until then, steer to the quiz.
// Free text goes to an agent behind /api/agents/<agent>/turn (B's Mastra agents). Requests for sources,
  // examples or real-world data go to the Researcher (Bright Data web search, cited); everything else to the Tutor.
  const RESEARCH = /\b(sources?|cite|citation|look (it )?up|search|real[- ]world|examples? (of|from)|news|article|research|data on)\b/i;
  const askTutor = async (text: string, fallback?: () => void) => {
    const agent: "tutor" | "researcher" = RESEARCH.test(text) ? "researcher" : "tutor";
    const history = entries
      .filter((e): e is Extract<Entry, { who: "tutor" | "student" }> => e.who !== "card")
      .slice(-8)
      .map((e) => ({ role: e.who === "student" ? ("user" as const) : ("assistant" as const), content: e.text }));
    setLiveAgent(agent);
    setLiveStep(null);
    setTutorLive("");
    const r = await agentTurn(agent, { attemptId, input: text, history }, (soFar) => setTutorLive(soFar), (ev) => {
      if (ev.toolCall && !ev.toolCall.result) setLiveStep(TOOL_LABEL[ev.toolCall.name] ?? ev.label);
    });
    setTutorLive(null);
    setLiveStep(null);
    if (r.text) {
      // The Researcher appends its own "Sources:" list; we render citations from `sources` instead.
      const body = agent === "researcher" ? r.text.replace(/\n+\s*sources?:\s*\n[\s\S]*$/i, "").trim() : r.text;
      // Honest labelling when B's server answered with a recorded earlier turn.
      const note = r.replay
        ? `Replaying a recorded answer${r.replay.recordedAt ? ` from ${new Date(r.replay.recordedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}.`
        : undefined;
      say("tutor", body, { agent: agent === "researcher" ? "Researcher" : undefined, sources: r.sources?.filter((x) => x.verified), note });
    } else if (fallback) fallback();
    else say("tutor", "I can't answer right now. Let's keep going, and ask me again in a moment.");
  };

  const freeText = (text: string) => {
    say("student", text);
    const match = attemptId ? null : matchQuiz(quizzes, text);
    if (match) {
      setQuizId(match.id);
      say("tutor", `Let's work on ${match.title}: ${qs(match.items.length)}. Practice run, or the graded quiz?`, { agent: "Tutor" });
      setPhase("intro");
    } else if (text === "I'm not sure what to study.") {
      say("tutor", "Happy to help. Which topic are we working on? Pick one and I'll quiz you, with a short think-aloud along the way.", { agent: "Tutor" });
      setPhase("pick");
    } else {
      if (phase === "home") setPhase("pick");
      askTutor(text, () => say("tutor", "Which topic are we working on? Pick one and I'll quiz you, with a short think-aloud along the way."));
    }
  };

  const sidebarGroups = [
    ...sessionGroups,
    { label: "Topics", items: quizzes.map((q) => ({ id: `topic-${q.id}`, title: q.title, href: `/quiz/${q.id}`, subtitle: `${qs(q.items.length)}` })) },
  ];

  const composerProps = phase === "home" || phase === "intro" || phase === "pick"
      ? { textareaId: "composer-input", submitId: "composer-send", placeholder: "Tell me what you're studying, or say \"quiz me\"...", disabled: false }
      : {
          textareaId: "composer-input",
          submitId: "composer-send",
          placeholder: phase === "done" ? "Ask the tutor about your results..." : "Ask the tutor about this question...",
          disabled: tutorLive !== null || phase === "checking" || phase.startsWith("probe_"),
        };

  const composerEl = (
    <Composer
      key="composer"
      {...composerProps}
      value={draft}
      onChange={(v) => setDraft(v)}
      onSubmit={(v) => {
        if (v.trim()) {
          setDraft("");
          freeText(v.trim());
        }
      }}
      voice={null}
    />
  );

  // ---- the think-aloud as a focused scene (D's ThinkAloudScene); ids unchanged for A's agents ----
  const sceneStep: ThinkAloudStep | null =
    phase === "probe_choice" || phase === "probe_consent" || phase === "probe_before"
      ? 1
      : phase === "probe_explain" || phase === "probe_voice"
        ? 2
        : phase === "probe_cf_loading" || phase === "probe_cf"
          ? 3
          : phase === "probe_after"
            ? 4
            : null;
  const chosenText = item ? choiceText(item, answer) : "";
  const scene =
    sceneStep && item ? (
      <div id="probe" data-step={probeStep} data-probe-id={probeId ?? ""}>
        <ThinkAloudScene
          step={sceneStep}
          question={{ label: `Q${index + 1}`, stem: item.stem, chosen: chosenText }}
          agent="explain-coach"
          orb={phase === "probe_voice" ? voice.orb : phase === "probe_cf_loading" ? "thinking" : null}
          prompt={
            phase === "probe_choice"
              ? "Quick think-aloud before I tell you how that went. Talk or type, whichever you like."
              : phase === "probe_consent"
                ? "Talking it through records your voice so it can be transcribed. The audio is deleted after grading."
                : phase === "probe_before"
                  ? "Before you explain: how sure are you that you understand why your answer is right?"
                  : phase === "probe_explain"
                    ? <span id="probe-opening">{opening}</span>
                    : phase === "probe_voice"
                      ? voice.lines.filter((l) => l.role === "agent").at(-1)?.text ?? "Connecting..."
                      : phase === "probe_cf_loading"
                        ? "Thinking of a follow-up..."
                        : phase === "probe_cf"
                          ? <span id="probe-counterfactual">{cfPrompt}</span>
                          : "Now that you've explained it, how sure are you?"
          }
          transcript={
            phase === "probe_voice"
              ? voice.error
                ? `Voice hit a problem (${voice.error}). Type instead, no penalty.`
                : voice.lines.filter((l) => l.role === "user").at(-1)?.text
              : undefined
          }
          footer={
            phase === "probe_after" && before !== null
              ? `Before you explained, you said ${before} of 7 sure.`
              : phase === "probe_choice" && mode === "graded"
                ? "Typed answers are fine; your teacher may follow up in person."
                : "Graded on your reasoning, never on wording or accent."
          }
          actions={
            phase === "probe_choice" ? (
              mode === "graded" && voiceAvailable ? (
                <>
                  <PillButton id="probe-voice" onClick={() => { setChannel("voice"); setPhase("probe_consent"); }}>Talk it through</PillButton>
                  <PillButton id="probe-type" variant="secondary" onClick={() => { setChannel("typed"); setPhase("probe_before"); }}>Type it instead</PillButton>
                </>
              ) : (
                <>
                  <PillButton id="probe-type" onClick={() => { setChannel("typed"); setPhase("probe_before"); }}>Type it</PillButton>
                  <PillButton id="probe-voice" variant="secondary" disabled={!voiceAvailable} title={voiceAvailable ? undefined : "Voice isn't set up yet"} onClick={() => { setChannel("voice"); setPhase("probe_consent"); }}>
                    Talk it through
                  </PillButton>
                  {mode === "practice" && (
                    <PillButton id="probe-skip" variant="ghost" onClick={() => { if (lastCardId !== null && lastCorrect !== null) revealResult(lastCardId, lastCorrect, lastKey ?? undefined); setPhase("feedback"); }}>
                      Skip this time
                    </PillButton>
                  )}
                </>
              )
            ) : phase === "probe_consent" ? (
              <>
                <PillButton id="probe-consent-continue" onClick={() => setPhase("probe_before")} disabled={!consent}>Continue</PillButton>
                <PillButton id="probe-consent-type" variant="ghost" onClick={() => { setChannel("typed"); setPhase("probe_before"); }}>Type instead</PillButton>
              </>
            ) : phase === "probe_before" ? (
              <PillButton id="probe-begin" onClick={beginProbe} disabled={before === null || busy}>Continue</PillButton>
            ) : phase === "probe_explain" ? (
              <>
                <PillButton id="probe-submit-explanation" onClick={submitExplanation} disabled={!draft.trim()}>Done explaining</PillButton>
                {!retried && <PillButton id="probe-start-over" variant="ghost" onClick={startOver}>Start over</PillButton>}
              </>
            ) : phase === "probe_voice" ? (
              <>
                <PillButton id="probe-switch-typing" variant="secondary" onClick={switchToTyping}>Type instead</PillButton>
                <PillButton id="probe-voice-done" onClick={voice.stop}>Done explaining</PillButton>
              </>
            ) : phase === "probe_cf" ? (
              <PillButton id="probe-submit-cf" onClick={submitCounterfactual} disabled={!draft.trim()}>Continue</PillButton>
            ) : phase === "probe_after" ? (
              <PillButton id="probe-finish" onClick={finishProbe} disabled={after === null || busy}>Finish</PillButton>
            ) : null
          }
        >
          {phase === "probe_consent" && (
            <label htmlFor="probe-consent-check" className="flex items-start gap-2 text-sm">
              <input id="probe-consent-check" type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              I agree to have this short conversation recorded. I can switch to typing any time.
            </label>
          )}
          {phase === "probe_before" && <ConfidencePicker name="confidence-before" legend="How sure are you?" value={before} onChange={setBefore} />}
          {phase === "probe_explain" && (
            <ExplainBox
              ref={explanationRef}
              id="probe-explanation"
              aria-label="Your explanation"
              placeholder="In your own words..."
              value={draft}
              autoFocus
              onChange={(e) => {
                if (e.target.value) composerFirstKey();
                setDraft(e.target.value);
              }}
            />
          )}
          {phase === "probe_cf" && (
            <ExplainBox
              ref={followupRef}
              id="probe-cf-answer"
              aria-label="Your answer to the follow-up"
              placeholder="What changes, and why?"
              rows={3}
              value={draft}
              autoFocus
              onChange={(e) => {
                if (e.target.value) composerFirstKey();
                setDraft(e.target.value);
              }}
            />
          )}
          {phase === "probe_after" && <ConfidencePicker name="confidence-after" legend="How sure are you now?" value={after} onChange={setAfter} />}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </ThinkAloudScene>
      </div>
    ) : null;

  return (
    <ChatLayout
      scene={scene}
      sidebar={{
        groups: sidebarGroups,
        newHref: "/",
        newLabel: "New session",
        links: [
          { label: "Your progress", href: "/progress", icon: <BarChart3 /> },
          ...(viewer?.role === "professor" ? [{ label: "Professor studio", href: "/studio", icon: <FlaskConical /> }] : []),
          ...(viewer ? [{ label: "Sign out", href: "/signout", icon: <LogOut /> }] : []),
        ],
        user: { name: viewer?.name ?? student ?? "Student", detail: viewer?.role === "professor" ? "Professor" : "Student" },
      }}
      agents={AGENTS}
      empty={phase === "home"}
      home={{
        greeting: "What are we learning today?",
        sub: "Tell me what you're studying, or pick a topic. I'll quiz you and ask you to explain your thinking.",
        chips: (
          <>
            {quizzes.slice(0, 4).map((q) => (
              <Chip key={q.id} onClick={() => start("practice", q)}>
                Practice {q.title.replace(/^[^:]*:\s*/, "")}
              </Chip>
            ))}
            <Chip onClick={() => freeText("I'm not sure what to study.")}>Help me choose</Chip>
          </>
        ),
      }}
      composer={composerEl}
      composerNote={phase === "home" ? undefined : mode === "practice" ? "Practice mode · nothing here counts toward your grade" : "Graded quiz · think-alouds count for 10%"}
    >
      <Thread>
        <div id="chat-thread" className="space-y-6">
          {!startEmpty && (
          <Message role="tutor">
            <p>
              Ready for <strong>{quiz.title}</strong>? {qs(quiz.items.length)}. Practice tells you how you did after each one; the graded quiz shows results at the end.
            </p>
          </Message>
          )}

          {entries.map((e) =>
            e.who === "tutor" ? (
              <Message key={e.id} role="tutor" agentName={e.agent && e.agent !== "Tutor" ? e.agent : undefined}>
                <p>
                  <RichText text={e.text} />
                </p>
                {e.note && <p className="mt-2 text-xs text-muted-foreground">{e.note}</p>}
                {e.sources && e.sources.length > 0 && (
                  <ol className="mt-3 space-y-1 text-sm" aria-label="Sources">
                    {e.sources.map((src, i) => (
                      <li key={src.url} className="flex gap-2">
                        <span className="text-muted-foreground tabular-nums">{i + 1}.</span>
                        <a href={src.url} target="_blank" rel="noopener noreferrer" className="truncate text-brand underline-offset-2 hover:underline">
                          {src.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 80)}
                        </a>
                      </li>
                    ))}
                  </ol>
                )}
              </Message>
            ) : e.who === "card" ? (
              <AnsweredCard key={e.id} entry={e} quiz={quiz} />
            ) : (
              <Message key={e.id} role="student">
                {e.text}
              </Message>
            ),
          )}

          {phase === "pick" && (
            <div id="topic-picker" className="flex flex-wrap gap-2">
              {quizzes.map((q) => (
                <Chip
                  key={q.id}
                  onClick={() => {
                    setQuizId(q.id);
                    say("student", q.title);
                    say("tutor", `${q.title}: ${qs(q.items.length)}. Practice run, or the graded quiz?`, { agent: "Tutor" });
                    setPhase("intro");
                  }}
                >
                  {q.title}
                </Chip>
              ))}
            </div>
          )}

          {phase === "intro" && (
            <div id="quiz-start" className="flex flex-wrap gap-2">
              <PillButton id="start-practice" variant={suggestedMode === "practice" ? "primary" : "secondary"} onClick={() => start("practice")} disabled={busy}>
                Start practice
              </PillButton>
              <PillButton id="start-graded" variant={suggestedMode === "graded" ? "primary" : "secondary"} onClick={() => start("graded")} disabled={busy}>
                Start graded quiz
              </PillButton>
            </div>
          )}

          {(phase === "question" || phase === "checking") && item && (
            <form
              id="quiz-item-form"
              data-attempt-id={attemptId ?? ""}
              data-mode={mode}
              onSubmit={(e) => {
                e.preventDefault();
                submitAnswer();
              }}
            >
              <QuestionCard
                label={`Question ${index + 1} of ${quiz.items.length} · ${mode === "practice" ? "Practice" : "Graded"}`}
                stem={item.stem}
                footer={
                  <PillButton id="submit-answer" type="submit" disabled={busy || isEmpty(answer)}>
                    {phase === "checking" ? "Checking..." : mode === "graded" && isLast ? "Submit quiz" : "Submit answer"}
                  </PillButton>
                }
              >
                <p id="item-progress" className="sr-only">
                  Question {index + 1} of {quiz.items.length}
                </p>
                <ItemView
                  key={item.id}
                  item={item}
                  value={answer}
                  onChange={changeAnswer}
                  disabled={phase !== "question" || busy}
                  hideStem
                  onAccessible={item.figure ? requestAccessible : undefined}
                  figureText={figureTexts[item.id] ?? null}
                />
              </QuestionCard>
            </form>
          )}
          {phase === "checking" && <Thinking label="Tutor is checking your answer" />}

          {/* Practice only: the Tutor builds a practice question on current official data (B's todaysPractice tool). */}
          {mode === "practice" && attemptId && tutorLive === null && (phase === "question" || phase === "feedback" || phase === "done") && (
            <div className="flex flex-wrap gap-2">
              <Chip onClick={() => freeText("Can I practice with today's real data?")}>
                <span id="chip-todays-data">Practice with today&apos;s data</span>
              </Chip>
            </div>
          )}

          {phase === "feedback" && lastCorrect !== null && (
            <Message role="tutor">
              <p id="item-feedback" role="status" data-correct={lastCorrect}>
                {item ? feedbackText(item, lastCorrect, lastKey) : null}
              </p>
              <div className="mt-3">
                <PillButton id={isLast ? "finish-quiz" : "next-item"} onClick={nextQuestion}>
                  {isLast ? "See results" : "Next question"}
                </PillButton>
              </div>
            </Message>
          )}

          {phase === "probe_done" && (
            <div id="probe" data-step="done" data-probe-id={probeId ?? ""}>
              <Message role="tutor" agentName="Explain coach">
                <p id="probe-done">Got it, thank you.</p>
                <div className="mt-3">
                  <PillButton id="probe-continue" onClick={probeContinue}>
                    {mode === "practice" ? "See how I did" : "Back to the quiz"}
                  </PillButton>
                </div>
              </Message>
            </div>
          )}

          {phase === "done" && summary && (
            <Message role="tutor">
              <div id="quiz-done" className="space-y-2">
                <p id="quiz-score" className="font-medium">
                  You got {summary.score} of {summary.total}.
                </p>
                <ol className="list-decimal space-y-1 pl-6 text-sm">
                  {summary.results.map((r, i) => (
                    <li key={r.itemId} data-item-id={r.itemId} data-correct={r.correct}>
                      Question {i + 1}: {r.answered ? (r.correct ? "correct" : "worth another look") : "skipped"}
                    </li>
                  ))}
                </ol>
              </div>
            </Message>
          )}

          {tutorLive !== null &&
            (tutorLive ? (
              <Message role="tutor" agentName={liveAgent === "researcher" ? "Researcher" : undefined}>
                <p id="tutor-live">
                  <RichText text={tutorLive} />
                </p>
              </Message>
            ) : (
              <Thinking
                label={
                  liveAgent === "researcher"
                    ? (liveStep ?? "Researcher is looking for sources") + " (can take about 30 seconds)"
                    : liveStep ?? "Tutor is thinking"
                }
              />
            ))}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div ref={bottom} />
        </div>
      </Thread>
    </ChatLayout>
  );
}
