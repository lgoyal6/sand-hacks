"use client";
// Headless voice think-aloud (ElevenLabs agent). The chat renders the transcript lines as messages
// and the orb in the composer. Must be used inside <ConversationProvider> from @elevenlabs/react.
// Flow: agent opens -> student explains -> agent calls `get_followup` (we generate the counterfactual
// from the live transcript) -> agent asks it -> student answers -> agent calls `end_probe`.
// Speech onsets come from the agent's VAD scores, stamped in the browser at the real moment.
import { useCallback, useEffect, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import type { VoiceOrbState } from "@/components/ui/siri-orb";
import { emitAgentStatus } from "@/lib/telemetry/agent-status";

export type ProbePhase = "prompt" | "speech_start" | "speech_end" | "cf_prompt" | "cf_speech_start" | "cf_speech_end";
export type VoiceStage = "idle" | "connecting" | "explain" | "followup_loading" | "followup" | "closing" | "ended";
/** Recoverable problems, each shown with a clear retry. */
export type VoiceIssue = "denied" | "no-mic" | "slow" | "silent" | "dropped" | null;
export interface VoiceLine {
  role: "agent" | "user";
  text: string;
}
export interface VoiceResult {
  conversationId: string | null;
  counterfactualPrompt: string;
  counterfactualLatencyMs?: number;
  lines: VoiceLine[];
  endedBy: "agent" | "student" | "disconnect";
}

const VAD_SPEECH = 0.6;
const FALLBACK_CF = "What would change in your answer if one number in the problem doubled?";

export function useVoiceProbe(opts: { mark: (p: ProbePhase) => void; onFinished: (r: VoiceResult) => void }) {
  const [stage, setStage] = useState<VoiceStage>("idle");
  const [lines, setLines] = useState<VoiceLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [issue, setIssue] = useState<VoiceIssue>(null);
  const lastArgs = useRef<{ probeId: string; signedUrl: string; dynamicVariables: Record<string, string> } | null>(null);
  const heardSpeech = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const stageRef = useRef<VoiceStage>("idle");
  const linesRef = useRef<VoiceLine[]>([]);
  const probeIdRef = useRef<string | null>(null);
  const convId = useRef<string | null>(null);
  const cfPrompt = useRef("");
  const agentSpoke = useRef(false);
  const marked = useRef<Partial<Record<ProbePhase, number>>>({});
  const endedBy = useRef<VoiceResult["endedBy"] | null>(null);
  const finished = useRef(true);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const go = (s: VoiceStage) => {
    stageRef.current = s;
    setStage(s);
  };
  const markOnce = useCallback((p: ProbePhase) => {
    if (marked.current[p] !== undefined) return;
    marked.current[p] = performance.now();
    optsRef.current.mark(p);
  }, []);

  const result = useCallback((): VoiceResult => {
    const m = marked.current;
    return {
      conversationId: convId.current,
      counterfactualPrompt: cfPrompt.current,
      counterfactualLatencyMs: m.cf_prompt !== undefined && m.cf_speech_start !== undefined ? Math.round(m.cf_speech_start - m.cf_prompt) : undefined,
      lines: linesRef.current,
      endedBy: endedBy.current ?? "disconnect",
    };
  }, []);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    go("ended");
    emitAgentStatus("explain-coach", "finished listening", "done");
    optsRef.current.onFinished(result());
  }, [result]);

  const conversation = useConversation({
    clientTools: {
      get_followup: async (params: Record<string, unknown>) => {
        markOnce("speech_end");
        go("followup_loading");
        emitAgentStatus("explain-coach", "preparing a follow-up");
        const said = linesRef.current.filter((l) => l.role === "user").map((l) => l.text).join(" ");
        const summary = typeof params.explanation_summary === "string" ? params.explanation_summary : "";
        try {
          const res = await fetch(`/api/probes/${probeIdRef.current}/counterfactual`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ explanation: said || summary }),
          });
          cfPrompt.current = ((await res.json()) as { prompt?: string }).prompt ?? FALLBACK_CF;
        } catch {
          cfPrompt.current = FALLBACK_CF;
        }
        go("followup");
        emitAgentStatus("explain-coach", "listening");
        return cfPrompt.current;
      },
      end_probe: async () => {
        endedBy.current = "agent";
        go("closing");
        setTimeout(() => conversation.endSession(), 1200); // let the closing line finish
        return "ended";
      },
    },
    onConnect: ({ conversationId }) => {
      convId.current = conversationId;
      go("explain");
      emitAgentStatus("explain-coach", "listening");
    },
    onDisconnect: () => {
      clearTimers();
      // A drop before the agent wrapped up: offer a retry instead of silently finishing.
      if (!finished.current && endedBy.current === null && stageRef.current !== "closing") {
        setIssue("dropped");
        return;
      }
      finish();
    },
    onError: (message) => setError(String(message).slice(0, 200)),
    onMessage: ({ message, role, source }) => {
      if (!message?.trim()) return;
      const r: VoiceLine["role"] = (role ?? source) === "user" ? "user" : "agent";
      if (r === "agent") agentSpoke.current = true;
      // Expressive-mode audio tags like "[happy]" are voice direction, not words: drop them from the text.
      const text = message.replace(/\[[a-z ]{2,20}\]\s*/gi, "").trim();
      if (!text) return;
      linesRef.current = [...linesRef.current, { role: r, text }];
      setLines(linesRef.current);
    },
    onModeChange: ({ mode }) => {
      // The agent just stopped talking: the student's turn (and the latency clock) starts now.
      if (mode !== "listening" || !agentSpoke.current) return;
      if (stageRef.current === "explain") markOnce("prompt");
      if (stageRef.current === "followup") markOnce("cf_prompt");
      // Silent mic: nothing heard 12 s after the coach finished asking.
      if (!heardSpeech.current) timers.current.push(setTimeout(() => !heardSpeech.current && setIssue((i) => i ?? "silent"), 12000));
    },
    onVadScore: ({ vadScore }) => {
      if (vadScore < VAD_SPEECH) return;
      if (!heardSpeech.current) {
        heardSpeech.current = true;
        setIssue((i) => (i === "silent" ? null : i));
      }
      const m = marked.current;
      if (stageRef.current === "explain" && m.prompt !== undefined) markOnce("speech_start");
      if (stageRef.current === "followup" && m.cf_prompt !== undefined) markOnce("cf_speech_start");
    },
  });

  // The answer to the follow-up ends when the agent starts its closing line.
  useEffect(() => {
    if (conversation.isSpeaking && stageRef.current === "followup" && marked.current.cf_speech_start !== undefined) markOnce("cf_speech_end");
  }, [conversation.isSpeaking, markOnce]);

  const start = useCallback(
    async (args: { probeId: string; signedUrl: string; dynamicVariables: Record<string, string> }) => {
      lastArgs.current = args;
      clearTimers();
      setIssue(null);
      heardSpeech.current = false;
      // Mic pre-check, so a denied or missing microphone gets a clear message instead of a stuck orb.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (e) {
        const name = (e as DOMException).name;
        setIssue(name === "NotFoundError" || name === "OverconstrainedError" ? "no-mic" : "denied");
        go("idle");
        return;
      }
      probeIdRef.current = args.probeId;
      convId.current = null;
      cfPrompt.current = "";
      agentSpoke.current = false;
      marked.current = {};
      endedBy.current = null;
      finished.current = false;
      linesRef.current = [];
      setLines([]);
      setError(null);
      go("connecting");
      emitAgentStatus("explain-coach", "connecting");
      timers.current.push(setTimeout(() => stageRef.current === "connecting" && setIssue((i) => i ?? "slow"), 8000));
      conversation.startSession({ signedUrl: args.signedUrl, connectionType: "websocket", dynamicVariables: args.dynamicVariables });
    },
    [conversation],
  );

  const stop = useCallback(() => {
    endedBy.current = "student";
    conversation.endSession();
    finish();
  }, [conversation, finish]);

  /** Retry after a problem. A signed URL is single-use, so the caller provides a fresh one. */
  const retry = useCallback(
    async (fresh?: { signedUrl: string; dynamicVariables: Record<string, string> }) => {
      const prev = lastArgs.current;
      if (!prev) return;
      finished.current = true; // the old session must not report a finish
      try {
        conversation.endSession();
      } catch {
        /* already closed */
      }
      await start({ probeId: prev.probeId, ...(fresh ?? { signedUrl: prev.signedUrl, dynamicVariables: prev.dynamicVariables }) });
    },
    [conversation, start],
  );

  // Hang up without reporting a finish (the caller switches to typing).
  const abandon = useCallback((): VoiceResult => {
    endedBy.current = "student";
    finished.current = true;
    conversation.endSession();
    go("ended");
    emitAgentStatus("explain-coach", "switched to typing", "idle");
    return result();
  }, [conversation, result]);

  const orb: VoiceOrbState =
    stage === "connecting" || stage === "followup_loading" ? "thinking" : conversation.isSpeaking ? "speaking" : stage === "ended" || stage === "idle" ? "idle" : "listening";

  return { stage, lines, error, issue, orb, start, stop, abandon, retry, active: stage !== "idle" && stage !== "ended" };
}
