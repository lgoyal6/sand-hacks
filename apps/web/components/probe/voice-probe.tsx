"use client";
// Voice think-aloud with an ElevenLabs agent (build plan 4.4).
// The agent opens with "walk me through it", calls the `get_followup` client tool when the student has
// explained (we generate the counterfactual from their live transcript), asks it, then calls `end_probe`.
// Timing: speech onsets come from the agent's VAD scores, stamped in the browser at the real moment.
import { useCallback, useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Button } from "@/components/ui/button";
import { OrbAvatar } from "@/components/ui/orb-avatar";
import { VoiceOrb, type VoiceOrbState } from "@/components/ui/siri-orb";

type Phase = "prompt" | "speech_start" | "speech_end" | "cf_prompt" | "cf_speech_start" | "cf_speech_end";
type Stage = "connecting" | "explain" | "followup_loading" | "followup" | "closing" | "ended";

const VAD_SPEECH = 0.6; // agent VAD score above which we count the student as speaking

export interface VoiceResult {
  conversationId: string | null;
  counterfactualPrompt: string;
  counterfactualLatencyMs?: number;
  liveTranscript: { role: "agent" | "user"; text: string }[];
  endedBy: "agent" | "student" | "disconnect";
}

interface Props {
  probeId: string;
  signedUrl: string;
  dynamicVariables: Record<string, string>;
  mark: (phase: Phase) => void;
  onFinished: (r: VoiceResult) => void;
  onSwitchToTyping: (r: VoiceResult) => void;
}

export function VoiceProbe(props: Props) {
  return (
    <ConversationProvider>
      <VoiceProbeInner {...props} />
    </ConversationProvider>
  );
}

function VoiceProbeInner({ probeId, signedUrl, dynamicVariables, mark, onFinished, onSwitchToTyping }: Props) {
  const [stage, setStage] = useState<Stage>("connecting");
  const [lines, setLines] = useState<{ role: "agent" | "user"; text: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState("");
  const stageRef = useRef<Stage>("connecting");
  const linesRef = useRef(lines);
  const convId = useRef<string | null>(null);
  const cfPrompt = useRef("");
  const agentSpoke = useRef(false);
  const marked = useRef<Partial<Record<Phase, number>>>({});
  const endedBy = useRef<VoiceResult["endedBy"] | null>(null);
  const finished = useRef(false);

  const setStageBoth = (s: Stage) => {
    stageRef.current = s;
    setStage(s);
  };
  const markOnce = useCallback(
    (p: Phase) => {
      if (marked.current[p] !== undefined) return;
      marked.current[p] = performance.now();
      mark(p);
    },
    [mark],
  );

  const result = useCallback((): VoiceResult => {
    const m = marked.current;
    return {
      conversationId: convId.current,
      counterfactualPrompt: cfPrompt.current,
      counterfactualLatencyMs: m.cf_prompt !== undefined && m.cf_speech_start !== undefined ? Math.round(m.cf_speech_start - m.cf_prompt) : undefined,
      liveTranscript: linesRef.current,
      endedBy: endedBy.current ?? "disconnect",
    };
  }, []);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    setStageBoth("ended");
    onFinished(result());
  }, [onFinished, result]);

  const conversation = useConversation({
    clientTools: {
      get_followup: async (params: Record<string, unknown>) => {
        markOnce("speech_end");
        setStageBoth("followup_loading");
        const said = linesRef.current.filter((l) => l.role === "user").map((l) => l.text).join(" ");
        const summary = typeof params.explanation_summary === "string" ? params.explanation_summary : "";
        try {
          const res = await fetch(`/api/probes/${probeId}/counterfactual`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ explanation: said || summary }),
          });
          const d = (await res.json()) as { prompt?: string };
          cfPrompt.current = d.prompt ?? "What would change in your answer if one number in the problem doubled?";
        } catch {
          cfPrompt.current = "What would change in your answer if one number in the problem doubled?";
        }
        setStageBoth("followup");
        return cfPrompt.current;
      },
      end_probe: async () => {
        endedBy.current = "agent";
        setStageBoth("closing");
        // Let the agent's closing line finish playing before hanging up.
        setTimeout(() => conversation.endSession(), 1200);
        return "ended";
      },
    },
    onConnect: ({ conversationId }) => {
      convId.current = conversationId;
      setConversationId(conversationId);
      setStageBoth("explain");
    },
    onDisconnect: () => finish(),
    onError: (message) => setError(String(message).slice(0, 200)),
    onMessage: ({ message, role, source }) => {
      const r = (role ?? source) === "user" ? "user" : "agent";
      if (!message?.trim()) return;
      if (r === "agent") agentSpoke.current = true;
      setLines((prev) => {
        const next = [...prev, { role: r as "agent" | "user", text: message }];
        linesRef.current = next;
        return next;
      });
    },
    onModeChange: ({ mode }) => {
      // The agent just stopped talking: that's when the student's turn (and the latency clock) starts.
      if (mode !== "listening" || !agentSpoke.current) return;
      if (stageRef.current === "explain") markOnce("prompt");
      if (stageRef.current === "followup") markOnce("cf_prompt");
    },
    onVadScore: ({ vadScore }) => {
      if (vadScore < VAD_SPEECH) return;
      const m = marked.current;
      if (stageRef.current === "explain" && m.prompt !== undefined) markOnce("speech_start");
      if (stageRef.current === "followup" && m.cf_prompt !== undefined) markOnce("cf_speech_start");
    },
  });

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Errors (mic denied, socket failure) arrive through onError.
    conversation.startSession({ signedUrl, connectionType: "websocket", dynamicVariables });
    return () => {
      if (!finished.current) conversation.endSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The student's answer to the follow-up ends when the agent starts its closing line.
  useEffect(() => {
    if (conversation.isSpeaking && stage === "followup" && marked.current.cf_speech_start !== undefined) markOnce("cf_speech_end");
  }, [conversation.isSpeaking, stage, markOnce]);

  const orb: VoiceOrbState =
    stage === "followup_loading" || stage === "connecting" ? "thinking" : conversation.isSpeaking ? "speaking" : stage === "ended" ? "idle" : "listening";

  return (
    <div id="probe-voice-session" data-stage={stage} data-conversation-id={conversationId} className="space-y-4">
      <div className="flex justify-center">
        <VoiceOrb state={orb} size="120px" showLabel />
      </div>
      <ol id="probe-live-transcript" aria-live="polite" className="max-h-64 space-y-2 overflow-y-auto">
        {lines.map((l, i) => (
          <li key={i} className={l.role === "agent" ? "flex items-start gap-2" : "ml-10 rounded-md bg-muted px-3 py-2 text-sm"}>
            {l.role === "agent" && <OrbAvatar size="sm" />}
            <span className={l.role === "agent" ? "text-sm" : undefined}>{l.text}</span>
          </li>
        ))}
      </ol>
      {stage === "connecting" && <p className="text-sm text-muted-foreground">Connecting. Your browser will ask to use the microphone.</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          Voice hit a problem ({error}). You can switch to typing with no penalty.
        </p>
      )}
      <div className="flex gap-3">
        <Button
          id="probe-voice-done"
          variant="outline"
          onClick={() => {
            endedBy.current = "student";
            conversation.endSession();
            finish();
          }}
          disabled={stage === "ended"}
        >
          I&apos;m done
        </Button>
        <Button
          id="probe-switch-typing"
          variant="ghost"
          onClick={() => {
            endedBy.current = "student";
            finished.current = true;
            conversation.endSession();
            onSwitchToTyping(result());
          }}
          disabled={stage === "ended"}
        >
          Switch to typing
        </Button>
      </div>
    </div>
  );
}
