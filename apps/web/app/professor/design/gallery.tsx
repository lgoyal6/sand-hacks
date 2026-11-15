"use client";
// Interactive reference for the chat primitives (owner: D). Not product data: a scripted demo of the
// layout, so B and C can see how the pieces fit. Open /professor/design.
import * as React from "react";
import { BookOpen, Lightbulb, Target } from "lucide-react";
import { ChatLayout, Chip, Composer, Message, QuestionCard, Thinking, Thread, type AgentInfo } from "@/components/ui/chat";
import type { VoiceOrbState } from "@/components/ui/siri-orb";

const SIDEBAR = {
  groups: [
    { label: "Today", items: [{ id: "s1", title: "Intro Stats · Quiz 1", meta: "Practice", href: "/professor/design" }] },
    { label: "Yesterday", items: [{ id: "s2", title: "Confidence intervals", href: "#" }, { id: "s3", title: "Why n matters for SE", href: "#" }] },
  ],
  user: { name: "Sam", detail: "Intro Statistics" },
};

type Turn =
  | { kind: "tutor"; text: string }
  | { kind: "student"; text: string }
  | { kind: "question"; id: string }
  | { kind: "thinking"; label: string };

const AGENTS_IDLE: AgentInfo[] = [
  { id: "tutor", name: "Tutor", status: "ready", state: "idle" },
  { id: "checker", name: "Quiz checker", status: "tested 5 questions", state: "complete", steps: [{ text: "Ran 5 questions against practice agents", at: "9:41" }] },
  { id: "coach", name: "Explain coach", status: "waiting for your answer", state: "idle" },
  { id: "progress", name: "Progress", status: "updated", state: "complete" },
];

export function DesignGallery() {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [answer, setAnswer] = React.useState<string | string[]>("");
  const [graded, setGraded] = React.useState<{ correct: boolean; correctIds: string[] } | null>(null);
  const [voice, setVoice] = React.useState<VoiceOrbState | null>(null);
  const [agents, setAgents] = React.useState(AGENTS_IDLE);

  const setAgent = (id: string, patch: Partial<AgentInfo>) => setAgents((a) => a.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const start = () => {
    setTurns([
      { kind: "student", text: "Start Quiz 1" },
      { kind: "tutor", text: "Let's go. Five questions on sampling and inference. Take your time; after some answers I'll ask you to talk me through your thinking." },
      { kind: "question", id: "q1" },
    ]);
    setAgent("tutor", { status: "presenting question 1", state: "working" });
  };

  const submit = () => {
    const correct = answer === "b";
    setGraded({ correct, correctIds: ["b"] });
    setAgent("tutor", { status: "ready", state: "idle" });
    setAgent("coach", { status: "preparing a follow-up", state: "working", steps: [{ text: "Read your answer", at: "now" }, { text: "Choosing a what-if question", at: "now", done: false }] });
    setTurns((t) => [...t, { kind: "thinking", label: "Explain coach is preparing a follow-up" }]);
    setTimeout(() => {
      setTurns((t) => [
        ...t.filter((x) => x.kind !== "thinking"),
        { kind: "tutor", text: correct ? "That's right. Walk me through it: how did you get the standard error? Tap the mic and say it out loud, or type." : "Not quite. Tell me how you approached it, and we'll find the step together." },
      ]);
      setAgent("coach", { status: "listening", state: "needs-input" });
    }, 1400);
  };

  const composer = (
    <Composer
      textareaId="demo-composer"
      submitId="demo-send"
      onMic={() => setVoice("listening")}
      onAttach={() => undefined}
      onSubmit={(v) => {
        if (!turns.length) return start();
        setTurns((t) => [...t, { kind: "student", text: v }]);
      }}
      voice={
        voice
          ? {
              state: voice,
              transcript: voice === "listening" ? "Standard error is s over root n, so 10 over 5..." : voice === "speaking" ? "Good. Now what happens if the sample doubled?" : undefined,
              onStop: () => {
                setVoice("thinking");
                setTimeout(() => setVoice("speaking"), 900);
                setTimeout(() => setVoice(null), 3200);
              },
              onSwitchToTyping: () => setVoice(null),
            }
          : null
      }
    />
  );

  return (
    <ChatLayout
      sidebar={SIDEBAR}
      agents={agents}
      empty={turns.length === 0}
      title={turns.length ? "Intro Stats · Quiz 1" : undefined}
      home={{
        greeting: "What are we learning today?",
        sub: "Intro Statistics",
        chips: (
          <>
            <Chip icon={<Target />} onClick={start}>
              Start Quiz 1
            </Chip>
            <Chip icon={<BookOpen />}>Practice a weak topic</Chip>
            <Chip icon={<Lightbulb />}>Explain a concept</Chip>
          </>
        ),
      }}
      composer={composer}
      composerNote="Practice mode. Explaining out loud is optional."
    >
      <Thread>
        {turns.map((t, i) =>
          t.kind === "student" ? (
            <Message key={i} role="student">
              {t.text}
            </Message>
          ) : t.kind === "tutor" ? (
            <Message key={i} role="tutor" copyText={t.text}>
              <p>{t.text}</p>
            </Message>
          ) : t.kind === "thinking" ? (
            <Thinking key={i} label={t.label} />
          ) : (
            <QuestionCard
              key={i}
              label="Question 1 of 5 · Practice"
              stem="A sample of 25 has mean 40 and standard deviation 10. What is the standard error of the mean?"
              type="mcq"
              choices={[
                { id: "a", text: "0.4" },
                { id: "b", text: "2" },
                { id: "c", text: "10" },
                { id: "d", text: "50" },
              ]}
              value={answer}
              onChange={setAnswer}
              onSubmit={submit}
              result={graded ?? undefined}
            />
          ),
        )}
      </Thread>
    </ChatLayout>
  );
}
