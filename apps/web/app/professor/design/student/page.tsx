"use client";
// Live reference for the student "quiz paper" (owner: D). Scripted demo of the layout only; the real flow,
// grading and probe logic live in C's components/quiz. Walk: intro -> question -> feedback -> think-aloud 1-4 -> summary.
import * as React from "react";
import {
  ChoiceList,
  ChoiceOption,
  ConfidencePicker,
  ExplainBox,
  Feedback,
  PaperIntro,
  PillButton,
  QuestionActions,
  QuestionStem,
  QuizPaper,
  ThinkAloudScene,
  type Helper,
  type QuizNavItem,
} from "@/components/ui/quiz";
import type { VoiceOrbState } from "@/components/ui/siri-orb";

type Screen = "intro" | "question" | "feedback" | "p1" | "p2" | "p3" | "p4" | "summary";

const CHOICES = [
  { id: "a", text: "It doubles" },
  { id: "b", text: "It halves" },
  { id: "c", text: "It shrinks to a quarter" },
  { id: "d", text: "It stays the same" },
];
const STEM = "If the sample size quadruples and nothing else changes, what happens to the width of a 95% confidence interval for the mean?";

export default function Page() {
  const [screen, setScreen] = React.useState<Screen>("intro");
  const [answer, setAnswer] = React.useState("");
  const [before, setBefore] = React.useState<number | null>(null);
  const [after, setAfter] = React.useState<number | null>(null);
  const [voice, setVoice] = React.useState(true);
  const [orb, setOrb] = React.useState<VoiceOrbState>("speaking");

  const nav: QuizNavItem[] = ["Q1", "Q2", "Q3", "Q4", "Q5"].map((label, i) => ({
    id: label,
    label,
    state: i === 0 ? "correct" : i === 1 ? (screen === "summary" ? "correct" : "current") : "todo",
  }));

  const coach = screen === "feedback";
  const helpers: Helper[] = [
    {
      agent: "tutor",
      status: coach ? "waiting" : "with you",
      active: !coach,
      message: "Take your time. After you answer, I may ask you to explain one of these out loud.",
    },
    {
      agent: "explain-coach",
      status: coach ? "wants to hear your reasoning" : "joins for a think-aloud",
      active: coach,
      message: "Nice. Can you walk me through why? It takes about a minute.",
    },
    { agent: "researcher", status: "worked examples on request" },
  ];

  const question = { label: "Q2", stem: "Sample size quadruples: what happens to the CI width?", chosen: "B · halves" };
  const go = (s: Screen) => () => setScreen(s);

  const scene =
    screen === "p1" ? (
      <ThinkAloudScene
        step={1}
        question={question}
        prompt="Before you explain: how sure are you?"
        actions={
          <PillButton id="probe-begin" disabled={before == null} onClick={go("p2")}>
            Continue
          </PillButton>
        }
        footer={<span>Practice. Graded on your reasoning, never on wording or accent.</span>}
      >
        <ConfidencePicker name="confidence-before" legend="" value={before} onChange={setBefore} />
      </ThinkAloudScene>
    ) : screen === "p2" ? (
      <ThinkAloudScene
        step={2}
        question={question}
        orb={voice ? orb : null}
        prompt="Walk me through it. Why would four times the data make the interval half as wide?"
        transcript={voice ? "“The width depends on the standard error, which is s over root n. If n goes up by four, root n goes up by two, so...”" : undefined}
        actions={
          voice ? (
            <>
              <PillButton id="probe-switch-typing" variant="secondary" onClick={() => setVoice(false)}>
                Type instead
              </PillButton>
              <PillButton id="probe-voice-done" onClick={go("p3")}>
                Done explaining
              </PillButton>
            </>
          ) : (
            <PillButton id="probe-submit-explanation" onClick={go("p3")}>
              Send explanation
            </PillButton>
          )
        }
        footer={
          <>
            <span>
              Before you explained, you said <strong className="text-foreground">{before ?? "-"} of 7</strong> sure.
            </span>
            {voice && (
              <span className="flex gap-2">
                {(["listening", "thinking", "speaking"] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setOrb(s)} className={s === orb ? "font-semibold text-foreground" : "hover:text-foreground"}>
                    {s}
                  </button>
                ))}
              </span>
            )}
          </>
        }
      >
        {!voice && <ExplainBox id="probe-explanation" placeholder="Explain it the way you'd tell a friend." />}
      </ThinkAloudScene>
    ) : screen === "p3" ? (
      <ThinkAloudScene
        step={3}
        question={question}
        prompt="What if your margin of error is 4 points and you need it down to 1? How much more data?"
        actions={
          <PillButton id="probe-submit-cf" onClick={go("p4")}>
            Answer
          </PillButton>
        }
        footer={<span>One quick follow-up. There&apos;s no trick.</span>}
      >
        <ExplainBox id="probe-cf-answer" rows={3} placeholder="Your answer, in a sentence or two" />
      </ThinkAloudScene>
    ) : screen === "p4" ? (
      <ThinkAloudScene
        step={4}
        question={question}
        prompt="Now that you've explained it, how sure are you?"
        actions={
          <PillButton id="probe-finish" disabled={after == null} onClick={go("summary")}>
            Finish
          </PillButton>
        }
        footer={
          <span>
            You started at <strong className="text-foreground">{before ?? "-"} of 7</strong>. Going down after explaining is normal; it&apos;s how you spot what to review.
          </span>
        }
      >
        <ConfidencePicker name="confidence-after" legend="" value={after} onChange={setAfter} />
      </ThinkAloudScene>
    ) : null;

  return (
    <QuizPaper
      course="Intro Statistics"
      quizTitle="Quiz 1"
      mode="practice"
      current={screen === "intro" ? undefined : screen === "summary" ? undefined : 2}
      total={screen === "intro" || screen === "summary" ? undefined : 5}
      nav={screen === "intro" ? [] : nav}
      helpers={helpers}
      onAskTutor={() => undefined}
      scene={scene}
      homeHref="/professor/design/student"
    >
      {screen === "intro" && (
        <PaperIntro
          title="Quiz 1 · Sampling and inference"
          actions={
            <>
              <PillButton onClick={go("question")}>Start practice</PillButton>
              <PillButton variant="secondary" onClick={go("question")}>
                Start graded quiz
              </PillButton>
            </>
          }
        >
          5 questions. In practice you see how you did after each one. Sometimes a helper will ask you to explain your thinking out loud; that&apos;s the part that makes it stick.
        </PaperIntro>
      )}

      {(screen === "question" || screen === "feedback") && (
        <>
          <QuestionStem topic="Question 2 · Confidence intervals" id="stem-q2">
            {STEM}
          </QuestionStem>
          <fieldset id="item-q2" aria-labelledby="stem-q2" disabled={screen === "feedback"}>
            <ChoiceList>
              {CHOICES.map((c, i) => (
                <ChoiceOption
                  key={c.id}
                  id={`choice-${c.id}`}
                  name="answer"
                  value={c.id}
                  letter={"ABCD"[i]}
                  checked={answer === c.id}
                  onChange={() => setAnswer(c.id)}
                  state={screen === "feedback" ? (c.id === "b" ? "correct" : answer === c.id ? "incorrect" : undefined) : undefined}
                >
                  {c.text}
                </ChoiceOption>
              ))}
            </ChoiceList>
          </fieldset>
          {screen === "feedback" && (
            <Feedback correct={answer === "b"}>
              {answer === "b"
                ? "The interval's width scales with 1/√n, so four times the data halves it."
                : "Width scales with 1/√n. Four times the data means √4 = 2, so the width halves."}
            </Feedback>
          )}
          <QuestionActions hint={screen === "question" ? "Pick one, then check." : undefined}>
            {screen === "question" ? (
              <PillButton id="submit-answer" disabled={!answer} onClick={go("feedback")}>
                Check answer
              </PillButton>
            ) : (
              <>
                <PillButton id="next-item" variant="secondary" onClick={go("summary")}>
                  Skip for now
                </PillButton>
                <PillButton id="probe-voice" onClick={go("p1")}>
                  Explain it
                </PillButton>
              </>
            )}
          </QuestionActions>
        </>
      )}

      {screen === "summary" && (
        <PaperIntro
          title="Nice work on Quiz 1"
          actions={
            <PillButton variant="secondary" onClick={() => { setScreen("intro"); setAnswer(""); setBefore(null); setAfter(null); setVoice(true); }}>
              Restart demo
            </PillButton>
          }
        >
          You explained question 2 out loud. Confidence went from {before ?? "-"} to {after ?? "-"} of 7. Your progress page shows what to review next.
        </PaperIntro>
      )}
    </QuizPaper>
  );
}
