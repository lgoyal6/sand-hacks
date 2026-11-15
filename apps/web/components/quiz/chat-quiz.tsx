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
import { ConversationProvider } from "@elevenlabs/react";
import { Button } from "@/components/ui/button";
import { ChatLayout, Chip, Composer, Message, QuestionCard, Thinking, Thread, type AgentInfo } from "@/components/ui/chat";
import { useTelemetry } from "@/lib/telemetry/use-telemetry";
import { emitAgentStatus } from "@/lib/telemetry/agent-status";
import { ConfidenceScale } from "@/components/probe/confidence-scale";
import { useVoiceProbe, type ProbePhase, type VoiceResult } from "@/components/probe/use-voice-probe";
import { ItemView } from "./item-view";
import type { Answer, Mode, PublicItem, PublicQuiz } from "./types";
import { rememberSession, useSessions } from "./sessions";

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

type Entry = { id: number; who: "tutor" | "student"; text: string; agent?: string; tone?: "good" | "review" };

// Clock for event handlers (wrapped so the React compiler doesn't mistake handler code for render code).
const now = () => performance.now();

function isEmpty(a: Answer) {
  return Array.isArray(a) ? a.length === 0 : a.trim() === "";
}
function answerText(item: PublicItem, a: Answer) {
  const ids = Array.isArray(a) ? a : [a];
  if (!item.choices) return String(a);
  return ids.map((id) => `${id}) ${item.choices!.find((c) => c.id === id)?.text ?? ""}`).join(", ");
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
}

const AGENTS: AgentInfo[] = [
  { id: "tutor", name: "Tutor", status: "ready when you are", state: "idle" },
  { id: "explain", name: "Explain coach", status: "joins for think-alouds", state: "idle" },
  { id: "grader", name: "Grader", status: "reviews explanations later", state: "idle" },
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

function ChatQuizInner({ quizzes, initialQuizId, suggestedMode = "practice", student, startEmpty = false }: ChatQuizProps) {
  const [phase, setPhase] = useState<Phase>(startEmpty ? "home" : "intro");
  const [quizId, setQuizId] = useState(initialQuizId ?? quizzes[0]?.id);
  const quiz = quizzes.find((q) => q.id === quizId) ?? quizzes[0];
  const sessions = useSessions();
  const [mode, setMode] = useState<Mode>(suggestedMode);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<Answer>("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
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

  const say = useCallback((who: Entry["who"], text: string, extra: Partial<Entry> = {}) => {
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
      const d = await post<{ attemptId: string }>("/api/attempts", { quizId: target.id, mode: m, studentPseudonym: student });
      setQuizId(target.id);
      setMode(m);
      setAttemptId(d.attemptId);
      rememberSession({ id: d.attemptId, quizId: target.id, title: target.title, mode: m, startedAt: new Date().toISOString() });
      if (window.location.pathname !== `/quiz/${target.id}`) window.history.replaceState(null, "", `/quiz/${target.id}?mode=${m}`);
      say("student", m === "practice" ? "Let's practice." : "I'm ready for the graded quiz.");
      say(
        "tutor",
        m === "practice"
          ? `Great. ${target.items.length} questions on ${target.title}. After each one I'll tell you how it went. Sometimes I'll ask you to talk through your thinking. That's the part that makes it stick.`
          : `${target.items.length} questions on ${target.title}. You'll see your results at the end. Once or twice I'll ask you to explain your reasoning in your own words.`,
        { agent: "Tutor" },
      );
      setIndex(0);
      setAnswer("");
      shownAt.current = now();
      setPhase("question");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finishQuiz = async () => {
    if (!attemptId) return;
    emitAgentStatus("Tutor", "adding up your results");
    const s = await post<NonNullable<typeof summary>>(`/api/attempts/${attemptId}/finish`);
    setSummary(s);
    setPhase("done");
    emitAgentStatus("Tutor", "results ready", "done");
  };

  const nextQuestion = async () => {
    if (phase === "feedback" && lastCorrect !== null) say("tutor", lastCorrect ? "Correct." : "Not quite. Worth a second look.", { agent: "Tutor", tone: lastCorrect ? "good" : "review" });
    if (isLast) return finishQuiz();
    setIndex((i) => i + 1);
    setAnswer("");
    setLastCorrect(null);
    shownAt.current = now();
    setPhase("question");
    telemetry.emit("answer", { type: "item_shown", index: index + 2 }, quiz.items[index + 1]?.id);
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
    emitAgentStatus("Tutor", "checking your answer");
    try {
      const seconds = Math.round(((now() - shownAt.current) / 1000) * 10) / 10;
      const d = await post<{ correct?: boolean; probe?: boolean }>(`/api/attempts/${attemptId}/responses`, { itemId: item.id, answer, seconds });
      telemetry.emit("answer", { type: "submit", value: answer, seconds });
      telemetry.flush();
      say("student", `Q${index + 1}: ${answerText(item, answer)}`);
      emitAgentStatus("Tutor", "answer saved", "idle");
      if (mode === "practice") setLastCorrect(Boolean(d.correct));
      if (d.probe) {
        // The think-aloud comes before any feedback, so knowing the result doesn't color the explanation.
        say("tutor", "Before I tell you how that went: quick think-aloud. Explaining your reasoning is one of the best ways to lock it in, and only your reasoning counts, never wording or accent.", { agent: "Explain coach" });
        setBefore(null);
        setAfter(null);
        setConsent(false);
        setDraft("");
        setExplanation("");
        setCfPrompt("");
        setRetried(false);
        setProbeId(null);
        probeIdRef.current = null;
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
      emitAgentStatus("Explain coach", "waiting for your explanation", "idle");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const switchToTyping = () => {
    const r = voice.abandon();
    for (const l of r.lines) say(l.role === "agent" ? "tutor" : "student", l.text, l.role === "agent" ? { agent: "Explain coach" } : {});
    if (r.conversationId && probeIdRef.current) post(`/api/probes/${probeIdRef.current}`, { conversationId: r.conversationId }, "PATCH").catch(() => {});
    setChannel("typed");
    if (r.counterfactualPrompt) {
      setCfPrompt(r.counterfactualPrompt);
      setPhase("probe_cf");
    } else setPhase("probe_explain");
  };

  const submitExplanation = async () => {
    if (!probeId || !draft.trim()) return;
    mark("speech_end");
    const text = draft.trim();
    setExplanation(text);
    say("tutor", opening, { agent: "Explain coach" });
    say("student", text);
    setDraft("");
    setPhase("probe_cf_loading");
    emitAgentStatus("Explain coach", "preparing a follow-up");
    try {
      const d = await post<{ prompt: string }>(`/api/probes/${probeId}/counterfactual`, { explanation: text });
      setCfPrompt(d.prompt);
      setPhase("probe_cf");
      emitAgentStatus("Explain coach", "waiting for your answer", "idle");
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
            },
        "PATCH",
      );
      say("student", `Confidence: ${after} of 7`);
      emitAgentStatus("Grader", "will review your explanation", "idle");
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
    if (mode === "practice") setPhase("feedback");
    else nextQuestion();
  };

  // ---- composer (UI: swap for D's Composer; keep the ids) ----
  const composer =
    phase === "probe_explain"
      ? { textareaId: "probe-explanation", submitId: "probe-submit-explanation", placeholder: "Explain it in your own words..." }
      : phase === "probe_cf"
        ? { textareaId: "probe-cf-answer", submitId: "probe-submit-cf", placeholder: "What changes, and why?" }
        : null;
  const composerSubmit = () => {
    if (phase === "probe_explain") submitExplanation();
    else if (phase === "probe_cf") submitCounterfactual();
  };
  const composerFirstKey = () => {
    if (phase === "probe_explain") mark("speech_start");
    else if (phase === "probe_cf") mark("cf_speech_start");
  };

  useEffect(() => {
    if (phase === "probe_cf") mark("cf_prompt");
  }, [phase, mark]);

  const probeStep = phase.startsWith("probe_") ? phase.slice(6) : null;

  // Free text outside a probe step: the tutor's open chat arrives with B's agent API. Until then, steer to the quiz.
  const freeText = (text: string) => {
    say("student", text);
    const match = matchQuiz(quizzes, text);
    if (match) {
      setQuizId(match.id);
      say("tutor", `Let's work on ${match.title}: ${match.items.length} questions. Practice run, or the graded quiz?`, { agent: "Tutor" });
      setPhase("intro");
    } else {
      say("tutor", "Happy to help. Which topic are we working on? Pick one and I'll quiz you, with a short think-aloud along the way.", { agent: "Tutor" });
      setPhase("pick");
    }
  };

  const today = new Date().toDateString();
  const sidebarGroups = [
    { label: "Today", items: sessions.filter((x) => new Date(x.startedAt).toDateString() === today) },
    { label: "Earlier", items: sessions.filter((x) => new Date(x.startedAt).toDateString() !== today) },
  ]
    .filter((g) => g.items.length)
    .map((g) => ({ label: g.label, items: g.items.map((x) => ({ id: x.id, title: x.title, href: `/quiz/${x.quizId}?mode=${x.mode}`, subtitle: `${x.mode === "practice" ? "Practice" : "Quiz"} · ${new Date(x.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` })) }));

  sidebarGroups.unshift({ label: "Topics", items: quizzes.map((q) => ({ id: `topic-${q.id}`, title: q.title, href: `/quiz/${q.id}`, subtitle: `${q.items.length} questions` })) });

  const composerProps = composer
    ? { textareaId: composer.textareaId, submitId: composer.submitId, placeholder: composer.placeholder, disabled: false }
    : phase === "home" || phase === "intro" || phase === "pick"
      ? { textareaId: "composer-input", submitId: "composer-send", placeholder: "Ask about statistics, or say \"quiz me\"...", disabled: false }
      : { textareaId: "composer-input", submitId: "composer-send", placeholder: phase === "done" ? "Nice work. Start a new session from the sidebar." : "Answer the question above", disabled: true };

  const composerEl = (
    <Composer
      key="composer"
      {...composerProps}
      value={draft}
      onChange={(v) => {
        if (v && composer) composerFirstKey();
        setDraft(v);
      }}
      onSubmit={(v) => {
        if (composer) composerSubmit();
        else if (v.trim()) {
          setDraft("");
          freeText(v.trim());
        }
      }}
      voice={
        phase === "probe_voice"
          ? {
              state: voice.orb,
              transcript: voice.error ? `Voice hit a problem (${voice.error}). Type instead, no penalty.` : voice.lines.at(-1)?.text,
              onStop: voice.stop,
              onSwitchToTyping: switchToTyping,
            }
          : null
      }
    />
  );

  return (
    <ChatLayout
      sidebar={{ groups: sidebarGroups, newHref: "/", newLabel: "New session", user: { name: student ?? "Student", detail: "Intro Statistics" } }}
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
          <Message role="tutor" agentName="Tutor">
            <p>
              Ready for <strong>{quiz.title}</strong>? {quiz.items.length} questions. Practice tells you how you did after each one; the graded quiz shows results at the end.
            </p>
          </Message>
          )}

          {entries.map((e) =>
            e.who === "tutor" ? (
              <Message key={e.id} role="tutor" agentName={e.agent}>
                <p className={e.tone === "good" ? "text-verified" : e.tone === "review" ? "text-gap" : undefined}>{e.text}</p>
              </Message>
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
                    say("tutor", `${q.title}: ${q.items.length} questions. Practice run, or the graded quiz?`, { agent: "Tutor" });
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
              <Button id="start-practice" variant={suggestedMode === "practice" ? "default" : "outline"} onClick={() => start("practice")} disabled={busy}>
                Start practice
              </Button>
              <Button id="start-graded" variant={suggestedMode === "graded" ? "default" : "outline"} onClick={() => start("graded")} disabled={busy}>
                Start graded quiz
              </Button>
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
                  <Button id="submit-answer" type="submit" disabled={busy || isEmpty(answer)}>
                    {phase === "checking" ? "Checking..." : mode === "graded" && isLast ? "Submit quiz" : "Submit answer"}
                  </Button>
                }
              >
                <p id="item-progress" className="sr-only">
                  Question {index + 1} of {quiz.items.length}
                </p>
                <ItemView key={item.id} item={item} value={answer} onChange={changeAnswer} disabled={phase !== "question" || busy} hideStem />
              </QuestionCard>
            </form>
          )}
          {phase === "checking" && <Thinking label="Tutor is checking your answer" />}

          {phase === "feedback" && lastCorrect !== null && (
            <Message role="tutor" agentName="Tutor">
              <p id="item-feedback" role="status" data-correct={lastCorrect} className={lastCorrect ? "text-verified" : "text-gap"}>
                {lastCorrect ? "Correct." : "Not quite. Worth a second look before the graded quiz."}
              </p>
              <div className="mt-3">
                <Button id={isLast ? "finish-quiz" : "next-item"} onClick={nextQuestion}>
                  {isLast ? "See results" : "Next question"}
                </Button>
              </div>
            </Message>
          )}

          {probeStep && (
            <div id="probe" data-step={probeStep} data-probe-id={probeId ?? ""} className="space-y-6">
              {phase === "probe_choice" && (
                <Message role="tutor" agentName="Explain coach">
                  <p>Rate how sure you are, explain your thinking, then answer one short &quot;what if&quot;. About a minute. Talk or type, whichever you like.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button id="probe-type" onClick={() => { setChannel("typed"); setPhase("probe_before"); }}>
                      Type it
                    </Button>
                    <Button id="probe-voice" variant="outline" disabled={!voiceAvailable} title={voiceAvailable ? undefined : "Voice isn't set up yet"} onClick={() => { setChannel("voice"); setPhase("probe_consent"); }}>
                      Talk it through
                    </Button>
                    {mode === "practice" && (
                      <Button id="probe-skip" variant="ghost" onClick={() => setPhase("feedback")}>
                        Skip this time
                      </Button>
                    )}
                  </div>
                </Message>
              )}

              {phase === "probe_consent" && (
                <Message role="tutor" agentName="Explain coach">
                  <div id="probe-consent" className="space-y-3">
                    <p>Talking it through records your voice so it can be transcribed. The audio is deleted after grading. You can switch to typing at any time.</p>
                    <label htmlFor="probe-consent-check" className="flex items-start gap-2 text-sm">
                      <input id="probe-consent-check" type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                      I agree to have this short conversation recorded.
                    </label>
                    <div className="flex gap-2">
                      <Button id="probe-consent-continue" onClick={() => setPhase("probe_before")} disabled={!consent}>
                        Continue
                      </Button>
                      <Button id="probe-consent-type" variant="ghost" onClick={() => { setChannel("typed"); setPhase("probe_before"); }}>
                        Type instead
                      </Button>
                    </div>
                  </div>
                </Message>
              )}

              {phase === "probe_before" && (
                <Message role="tutor" agentName="Explain coach">
                  <ConfidenceScale name="confidence-before" legend="How sure are you that you understand why your answer is right?" value={before} onChange={setBefore} />
                  <div className="mt-3">
                    <Button id="probe-begin" onClick={beginProbe} disabled={before === null || busy}>
                      Continue
                    </Button>
                  </div>
                </Message>
              )}

              {phase === "probe_explain" && (
                <Message role="tutor" agentName="Explain coach">
                  <p id="probe-opening">{opening}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Type below. Just your own words, no need to be polished.</p>
                  {!retried && (
                    <Button id="probe-start-over" variant="ghost" size="sm" className="mt-2" onClick={startOver}>
                      Start over
                    </Button>
                  )}
                </Message>
              )}

              {phase === "probe_cf_loading" && <Thinking label="Explain coach is preparing a follow-up" />}

              {phase === "probe_cf" && (
                <Message role="tutor" agentName="Explain coach">
                  <p id="probe-counterfactual">{cfPrompt}</p>
                </Message>
              )}

              {phase === "probe_voice" &&
                voice.lines.map((l, i) =>
                  l.role === "agent" ? (
                    <Message key={`v${i}`} role="tutor" agentName="Explain coach">
                      <p>{l.text}</p>
                    </Message>
                  ) : (
                    <Message key={`v${i}`} role="student">
                      {l.text}
                    </Message>
                  ),
                )}

              {phase === "probe_after" && (
                <Message role="tutor" agentName="Explain coach">
                  <ConfidenceScale name="confidence-after" legend="How sure are you now?" value={after} onChange={setAfter} />
                  <div className="mt-3">
                    <Button id="probe-finish" onClick={finishProbe} disabled={after === null || busy}>
                      Finish
                    </Button>
                  </div>
                </Message>
              )}

              {phase === "probe_done" && (
                <Message role="tutor" agentName="Explain coach">
                  <p id="probe-done">Got it, thank you.</p>
                  <div className="mt-3">
                    <Button id="probe-continue" onClick={probeContinue}>
                      {mode === "practice" ? "See how I did" : "Back to the quiz"}
                    </Button>
                  </div>
                </Message>
              )}
            </div>
          )}

          {phase === "done" && summary && (
            <Message role="tutor" agentName="Tutor">
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
