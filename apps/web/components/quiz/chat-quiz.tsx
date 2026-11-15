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
import { VoiceOrb } from "@/components/ui/siri-orb";
import { OrbAvatar } from "@/components/ui/orb-avatar";
import { useTelemetry } from "@/lib/telemetry/use-telemetry";
import { emitAgentStatus } from "@/lib/telemetry/agent-status";
import { ConfidenceScale } from "@/components/probe/confidence-scale";
import { useVoiceProbe, type ProbePhase, type VoiceResult } from "@/components/probe/use-voice-probe";
import { ItemView } from "./item-view";
import type { Answer, Mode, PublicItem, PublicQuiz } from "./types";
import { rememberSession } from "./sessions";

type Phase =
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

export function ChatQuiz(props: { quiz: PublicQuiz; suggestedMode?: Mode; student?: string }) {
  return (
    <ConversationProvider>
      <ChatQuizInner {...props} />
    </ConversationProvider>
  );
}

function ChatQuizInner({ quiz, suggestedMode = "practice", student }: { quiz: PublicQuiz; suggestedMode?: Mode; student?: string }) {
  const [phase, setPhase] = useState<Phase>("intro");
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
  const telemetry = useTelemetry(attemptId, item?.id, phase !== "intro" && phase !== "done");

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
    const now = performance.now();
    marks.current[phaseName] = now;
    post(`/api/probes/${probeIdRef.current}/timing`, { phases: [{ phase: phaseName, ms: Math.round(now - t0.current), ts: new Date().toISOString() }] }).catch(() => {});
  }, []);

  // ---- quiz flow ----
  const start = async (m: Mode) => {
    setBusy(true);
    setError(null);
    try {
      const d = await post<{ attemptId: string }>("/api/attempts", { quizId: quiz.id, mode: m, studentPseudonym: student });
      setMode(m);
      setAttemptId(d.attemptId);
      rememberSession({ id: d.attemptId, quizId: quiz.id, title: quiz.title, mode: m, startedAt: new Date().toISOString() });
      say("student", m === "practice" ? "Let's practice." : "I'm ready for the graded quiz.");
      say(
        "tutor",
        m === "practice"
          ? `Great. ${quiz.items.length} questions on ${quiz.title}. After each one I'll tell you how it went. Sometimes I'll ask you to talk through your thinking. That's the part that makes it stick.`
          : `${quiz.items.length} questions on ${quiz.title}. You'll see your results at the end. Once or twice I'll ask you to explain your reasoning in your own words.`,
        { agent: "Tutor" },
      );
      setIndex(0);
      setAnswer("");
      shownAt.current = performance.now();
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
    shownAt.current = performance.now();
    setPhase("question");
    telemetry.emit("answer", { type: "item_shown", index: index + 2 }, quiz.items[index + 1]?.id);
  };

  const changeAnswer = (v: Answer) => {
    setAnswer(v);
    telemetry.emit("answer", { type: "change", value: v, sinceShownMs: Math.round(performance.now() - shownAt.current) });
  };

  const submitAnswer = async () => {
    if (!attemptId || !item || isEmpty(answer)) return;
    setBusy(true);
    setError(null);
    setPhase("checking");
    emitAgentStatus("Tutor", "checking your answer");
    try {
      const seconds = Math.round(((performance.now() - shownAt.current) / 1000) * 10) / 10;
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
      t0.current = performance.now();
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
    t0.current = performance.now();
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

  return (
    <div className="flex min-h-[70vh] flex-col">
      <div className="flex-1 space-y-4 pb-6" id="chat-thread">
        {/* Intro */}
        <TutorBubble agent="Tutor">
          <p>
            Ready for <strong>{quiz.title}</strong>? {quiz.items.length} questions. Practice tells you how you did after each one; the graded quiz shows results at the end.
          </p>
          {phase === "intro" && (
            <div id="quiz-start" className="mt-3 flex flex-wrap gap-2">
              <Button id="start-practice" variant={suggestedMode === "practice" ? "default" : "outline"} onClick={() => start("practice")} disabled={busy}>
                Start practice
              </Button>
              <Button id="start-graded" variant={suggestedMode === "graded" ? "default" : "outline"} onClick={() => start("graded")} disabled={busy}>
                Start graded quiz
              </Button>
            </div>
          )}
        </TutorBubble>

        {entries.map((e) =>
          e.who === "tutor" ? (
            <TutorBubble key={e.id} agent={e.agent}>
              <p className={e.tone === "good" ? "text-green-700 dark:text-green-400" : e.tone === "review" ? "text-amber-700 dark:text-amber-400" : undefined}>{e.text}</p>
            </TutorBubble>
          ) : (
            <StudentBubble key={e.id}>{e.text}</StudentBubble>
          ),
        )}

        {/* Active question (UI: D's QuestionCard) */}
        {(phase === "question" || phase === "checking") && item && (
          <form
            id="quiz-item-form"
            data-attempt-id={attemptId ?? ""}
            data-mode={mode}
            className="rounded-2xl border bg-card p-5 shadow-sm"
            onSubmit={(e) => {
              e.preventDefault();
              submitAnswer();
            }}
          >
            <p id="item-progress" className="mb-3 text-xs text-muted-foreground">
              Question {index + 1} of {quiz.items.length} · {mode === "practice" ? "Practice" : "Graded"}
            </p>
            <ItemView key={item.id} item={item} value={answer} onChange={changeAnswer} disabled={phase !== "question" || busy} />
            <div className="mt-4">
              <Button id="submit-answer" type="submit" disabled={busy || isEmpty(answer)}>
                {phase === "checking" ? "Checking..." : mode === "graded" && isLast ? "Submit quiz" : "Submit answer"}
              </Button>
            </div>
          </form>
        )}

        {phase === "feedback" && lastCorrect !== null && (
          <TutorBubble agent="Tutor">
            <p id="item-feedback" role="status" data-correct={lastCorrect} className={lastCorrect ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}>
              {lastCorrect ? "Correct." : "Not quite. Worth a second look before the graded quiz."}
            </p>
            <div className="mt-3">
              <Button id={isLast ? "finish-quiz" : "next-item"} onClick={nextQuestion}>
                {isLast ? "See results" : "Next question"}
              </Button>
            </div>
          </TutorBubble>
        )}

        {/* Active probe step */}
        {probeStep && (
          <div id="probe" data-step={probeStep} data-probe-id={probeId ?? ""} className="space-y-4">
            {phase === "probe_choice" && (
              <TutorBubble agent="Explain coach">
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
              </TutorBubble>
            )}

            {phase === "probe_consent" && (
              <TutorBubble agent="Explain coach">
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
              </TutorBubble>
            )}

            {phase === "probe_before" && (
              <TutorBubble agent="Explain coach">
                <ConfidenceScale name="confidence-before" legend="How sure are you that you understand why your answer is right?" value={before} onChange={setBefore} />
                <div className="mt-3">
                  <Button id="probe-begin" onClick={beginProbe} disabled={before === null || busy}>
                    Continue
                  </Button>
                </div>
              </TutorBubble>
            )}

            {phase === "probe_explain" && (
              <TutorBubble agent="Explain coach">
                <p id="probe-opening">{opening}</p>
                {!retried && (
                  <Button id="probe-start-over" variant="ghost" size="sm" className="mt-2" onClick={startOver}>
                    Start over
                  </Button>
                )}
              </TutorBubble>
            )}

            {phase === "probe_cf_loading" && (
              <TutorBubble agent="Explain coach">
                <p className="text-muted-foreground">Thinking of a follow-up...</p>
              </TutorBubble>
            )}

            {phase === "probe_cf" && (
              <TutorBubble agent="Explain coach">
                <p id="probe-counterfactual">{cfPrompt}</p>
              </TutorBubble>
            )}

            {phase === "probe_voice" && (
              <>
                {voice.lines.map((l, i) =>
                  l.role === "agent" ? (
                    <TutorBubble key={`v${i}`} agent="Explain coach">
                      <p>{l.text}</p>
                    </TutorBubble>
                  ) : (
                    <StudentBubble key={`v${i}`}>{l.text}</StudentBubble>
                  ),
                )}
                {voice.error && (
                  <p role="alert" className="text-sm text-destructive">
                    Voice hit a problem ({voice.error}). You can switch to typing with no penalty.
                  </p>
                )}
              </>
            )}

            {phase === "probe_after" && (
              <TutorBubble agent="Explain coach">
                <ConfidenceScale name="confidence-after" legend="How sure are you now?" value={after} onChange={setAfter} />
                <div className="mt-3">
                  <Button id="probe-finish" onClick={finishProbe} disabled={after === null || busy}>
                    Finish
                  </Button>
                </div>
              </TutorBubble>
            )}

            {phase === "probe_done" && (
              <TutorBubble agent="Explain coach">
                <p id="probe-done">Got it, thank you.</p>
                <div className="mt-3">
                  <Button id="probe-continue" onClick={probeContinue}>
                    {mode === "practice" ? "See how I did" : "Back to the quiz"}
                  </Button>
                </div>
              </TutorBubble>
            )}
          </div>
        )}

        {phase === "done" && summary && (
          <TutorBubble agent="Tutor">
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
          </TutorBubble>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div ref={bottom} />
      </div>

      {/* Composer (UI: D's Composer) */}
      <div className="sticky bottom-0 bg-background pb-4 pt-2">
        {phase === "probe_voice" ? (
          <div className="flex items-center justify-between gap-4 rounded-3xl border p-4 shadow-sm">
            <VoiceOrb state={voice.orb} size="64px" showLabel />
            <div className="flex gap-2">
              <Button id="probe-voice-done" variant="outline" onClick={voice.stop}>
                I&apos;m done
              </Button>
              <Button id="probe-switch-typing" variant="ghost" onClick={switchToTyping}>
                Switch to typing
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="flex items-end gap-2 rounded-3xl border p-3 shadow-sm"
            onSubmit={(e) => {
              e.preventDefault();
              composerSubmit();
            }}
          >
            <label htmlFor={composer?.textareaId ?? "composer-input"} className="sr-only">
              Message
            </label>
            <textarea
              id={composer?.textareaId ?? "composer-input"}
              className="max-h-48 min-h-12 flex-1 resize-none bg-transparent px-2 py-2 outline-none"
              placeholder={composer?.placeholder ?? (phase === "intro" ? "Pick practice or the graded quiz above to begin" : "Answer the question above")}
              disabled={!composer}
              value={composer ? draft : ""}
              onChange={(e) => {
                if (e.target.value) composerFirstKey();
                setDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  composerSubmit();
                }
              }}
            />
            <Button id={composer?.submitId ?? "composer-send"} type="submit" disabled={!composer || !draft.trim()}>
              Send
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

// UI: replace with D's Message.
function TutorBubble({ agent, children }: { agent?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <OrbAvatar size="sm" />
      <div className="max-w-[85%] space-y-1">
        {agent && <p className="text-xs text-muted-foreground">{agent}</p>}
        <div className="text-[15px] leading-relaxed">{children}</div>
      </div>
    </div>
  );
}
function StudentBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl bg-muted px-4 py-2 text-[15px]">{children}</div>
    </div>
  );
}
