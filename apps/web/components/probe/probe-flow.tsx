"use client";
// The think-aloud probe (build plan 2.2 step 6, 4.4):
// consent/intro -> confidence before -> "walk me through it" -> one counterfactual follow-up -> confidence after.
// Typed is a first-class path with no penalty. Voice (ElevenLabs) plugs into the same steps.
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfidenceScale } from "./confidence-scale";

type Step = "intro" | "before" | "explain" | "cf_loading" | "cf" | "after" | "done";
type Phase = "prompt" | "speech_start" | "speech_end" | "cf_prompt" | "cf_speech_start" | "cf_speech_end";

export interface ProbeFlowProps {
  attemptId: string;
  itemId: string;
  practice: boolean;
  onDone: (result: { probeId: string | null; skipped: boolean }) => void;
}

async function post<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

export function ProbeFlow({ attemptId, itemId, practice, onDone }: ProbeFlowProps) {
  const [step, setStep] = useState<Step>("intro");
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [before, setBefore] = useState<number | null>(null);
  const [after, setAfter] = useState<number | null>(null);
  const [probeId, setProbeId] = useState<string | null>(null);
  const [opening, setOpening] = useState("");
  const [explanation, setExplanation] = useState("");
  const [cfPrompt, setCfPrompt] = useState("");
  const [cfAnswer, setCfAnswer] = useState("");
  const [retried, setRetried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t0 = useRef(0);
  const marks = useRef<Partial<Record<Phase, number>>>({});

  useEffect(() => {
    fetch("/api/probes")
      .then((r) => r.json())
      .then((d) => setVoiceAvailable(Boolean(d.voiceAvailable)))
      .catch(() => {});
  }, []);

  const mark = useCallback(
    (phase: Phase, ms?: number) => {
      if (marks.current[phase] !== undefined) return; // first occurrence only
      const now = performance.now();
      marks.current[phase] = now;
      if (!probeId) return;
      post(`/api/probes/${probeId}/timing`, { phases: [{ phase, ms: ms ?? Math.round(now - t0.current), ts: new Date().toISOString() }] }).catch(() => {});
    },
    [probeId],
  );

  // Phase "prompt" is logged once the probe exists and the explain step is on screen.
  useEffect(() => {
    if (step === "explain" && probeId) {
      t0.current = performance.now();
      mark("prompt", 0);
    }
    if (step === "cf" && probeId) mark("cf_prompt");
  }, [step, probeId, mark]);

  const begin = async () => {
    if (before === null) return;
    setBusy(true);
    setError(null);
    try {
      const d = await post<{ probeId: string; opening: string }>("/api/probes", { attemptId, itemId, confidenceBefore: before, mode: "typed" });
      setProbeId(d.probeId);
      setOpening(d.opening);
      setStep("explain");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitExplanation = async () => {
    if (!probeId || !explanation.trim()) return;
    mark("speech_end");
    setStep("cf_loading");
    setError(null);
    try {
      const d = await post<{ prompt: string }>(`/api/probes/${probeId}/counterfactual`, { explanation });
      setCfPrompt(d.prompt);
      setStep("cf");
    } catch (e) {
      setError((e as Error).message);
      setStep("explain");
    }
  };

  const submitCounterfactual = () => {
    if (!cfAnswer.trim()) return;
    mark("cf_speech_end");
    setStep("after");
  };

  const finish = async () => {
    if (!probeId || after === null) return;
    setBusy(true);
    setError(null);
    const m = marks.current;
    const latency = m.cf_prompt !== undefined && m.cf_speech_start !== undefined ? Math.round(m.cf_speech_start - m.cf_prompt) : undefined;
    const transcript = [`Unprompted: ${opening}`, `Student (typed): ${explanation.trim()}`, `Unprompted: ${cfPrompt}`, `Student (typed): ${cfAnswer.trim()}`].join("\n");
    try {
      await post(`/api/probes/${probeId}`, { transcript, explanation, counterfactualAnswer: cfAnswer, confidenceAfter: after, counterfactualLatencyMs: latency, retried }, "PATCH");
      setStep("done");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const startOver = async () => {
    if (!probeId || retried) return;
    await post(`/api/probes/${probeId}`, { reset: true }, "PATCH").catch(() => {});
    setRetried(true);
    setExplanation("");
    setCfAnswer("");
    setCfPrompt("");
    marks.current = {};
    setStep("explain");
    t0.current = performance.now();
    mark("prompt", 0);
  };

  return (
    <Card id="probe" data-step={step} data-probe-id={probeId ?? ""}>
      <CardHeader>
        <CardTitle>Think it through out loud</CardTitle>
        <CardDescription>
          A quick check on how you got your answer. Explaining your reasoning is one of the best ways to lock it in. It isn&apos;t a trick, and wording or accent never counts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {step === "intro" && (
          <div className="space-y-4">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Rate how sure you are, explain your thinking, then answer one short &quot;what if&quot; question.</li>
              <li>About a minute. You can start over once.</li>
              <li>Voice is recorded only if you choose it, and audio is deleted after grading. Typing works just as well.</li>
            </ul>
            <div className="flex flex-wrap gap-3">
              <Button id="probe-type" onClick={() => setStep("before")}>
                Type my answer
              </Button>
              <Button id="probe-voice" variant="outline" disabled={!voiceAvailable} title={voiceAvailable ? undefined : "Voice isn't set up yet"}>
                Talk it through (records audio)
              </Button>
              {practice && (
                <Button id="probe-skip" variant="ghost" onClick={() => onDone({ probeId: null, skipped: true })}>
                  Skip in practice
                </Button>
              )}
            </div>
          </div>
        )}

        {step === "before" && (
          <div className="space-y-4">
            <ConfidenceScale name="confidence-before" legend="How sure are you that you understand why your answer is right?" value={before} onChange={setBefore} />
            <Button id="probe-begin" onClick={begin} disabled={before === null || busy}>
              Continue
            </Button>
          </div>
        )}

        {(step === "explain" || step === "cf_loading") && (
          <div className="space-y-3">
            <p id="probe-opening" className="font-medium">{opening}</p>
            <label htmlFor="probe-explanation" className="sr-only">Your explanation</label>
            <textarea
              id="probe-explanation"
              className="min-h-32 w-full rounded-md border bg-transparent p-3"
              value={explanation}
              disabled={step === "cf_loading"}
              onChange={(e) => {
                if (e.target.value) mark("speech_start");
                setExplanation(e.target.value);
              }}
              placeholder="In your own words..."
            />
            <div className="flex gap-3">
              <Button id="probe-submit-explanation" onClick={submitExplanation} disabled={!explanation.trim() || step === "cf_loading"}>
                {step === "cf_loading" ? "One moment..." : "Done explaining"}
              </Button>
              {!retried && (
                <Button id="probe-start-over" variant="ghost" onClick={startOver} disabled={step === "cf_loading"}>
                  Start over
                </Button>
              )}
            </div>
          </div>
        )}

        {step === "cf" && (
          <div className="space-y-3">
            <p id="probe-counterfactual" className="font-medium">{cfPrompt}</p>
            <label htmlFor="probe-cf-answer" className="sr-only">Your answer to the follow-up</label>
            <textarea
              id="probe-cf-answer"
              className="min-h-28 w-full rounded-md border bg-transparent p-3"
              value={cfAnswer}
              onChange={(e) => {
                if (e.target.value) mark("cf_speech_start");
                setCfAnswer(e.target.value);
              }}
              placeholder="What changes, and why?"
            />
            <Button id="probe-submit-cf" onClick={submitCounterfactual} disabled={!cfAnswer.trim()}>
              Continue
            </Button>
          </div>
        )}

        {step === "after" && (
          <div className="space-y-4">
            <ConfidenceScale name="confidence-after" legend="Now that you've explained it, how sure are you?" value={after} onChange={setAfter} />
            <Button id="probe-finish" onClick={finish} disabled={after === null || busy}>
              Finish
            </Button>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-3">
            <p id="probe-done">
              Thanks. {before !== null && after !== null && after < before
                ? "Your confidence moved after explaining. That's normal and useful: it points at exactly what to review."
                : "Explaining it is what makes it stick."}
            </p>
            <Button id="probe-continue" onClick={() => onDone({ probeId, skipped: false })}>
              Back to the quiz
            </Button>
          </div>
        )}

        {error && <p role="alert" className="text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
