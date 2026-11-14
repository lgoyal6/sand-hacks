"use client";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useTelemetry } from "@/lib/telemetry/use-telemetry";
import { ItemView } from "./item-view";
import type { Answer, Mode, PublicQuiz } from "./types";

type Phase = "start" | "answering" | "feedback" | "done";
type Result = { itemId: string; answered: boolean; correct: boolean };

function isEmpty(a: Answer) {
  return Array.isArray(a) ? a.length === 0 : a.trim() === "";
}

export function QuizRunner({ quiz }: { quiz: PublicQuiz }) {
  const [phase, setPhase] = useState<Phase>("start");
  const [mode, setMode] = useState<Mode>("practice");
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<Answer>("");
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ score: number; total: number; results: Result[] } | null>(null);
  const shownAt = useRef<number>(0);

  const item = quiz.items[index];
  const isLast = index === quiz.items.length - 1;
  const telemetry = useTelemetry(attemptId, item?.id, phase !== "start" && phase !== "done");

  const changeAnswer = useCallback(
    (v: Answer) => {
      setAnswer(v);
      telemetry.emit("answer", { type: "change", value: v, sinceShownMs: Math.round(performance.now() - shownAt.current) });
    },
    [telemetry],
  );

  const start = useCallback(
    async (m: Mode) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/attempts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quizId: quiz.id, mode: m }),
        });
        if (!res.ok) throw new Error("Could not start the quiz.");
        const data = await res.json();
        setMode(m);
        setAttemptId(data.attemptId);
        setIndex(0);
        setAnswer("");
        shownAt.current = performance.now();
        setPhase("answering");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [quiz.id],
  );

  const finish = useCallback(async () => {
    if (!attemptId) return;
    const res = await fetch(`/api/attempts/${attemptId}/finish`, { method: "POST" });
    setSummary(await res.json());
    setPhase("done");
  }, [attemptId]);

  const goNext = useCallback(async () => {
    if (isLast) return finish();
    setIndex((i) => i + 1);
    setAnswer("");
    setLastCorrect(null);
    shownAt.current = performance.now();
    setPhase("answering");
    telemetry.emit("answer", { type: "item_shown", index: index + 1 }, quiz.items[index + 1]?.id);
  }, [isLast, finish, telemetry, index, quiz.items]);

  const submit = useCallback(async () => {
    if (!attemptId || !item || isEmpty(answer)) return;
    setBusy(true);
    setError(null);
    try {
      const seconds = (performance.now() - shownAt.current) / 1000;
      const res = await fetch(`/api/attempts/${attemptId}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: item.id, answer, seconds: Math.round(seconds * 10) / 10 }),
      });
      if (!res.ok) throw new Error("Your answer didn't save. Try again.");
      const data = (await res.json()) as { correct?: boolean };
      telemetry.emit("answer", { type: "submit", value: answer, seconds: Math.round(seconds * 10) / 10 });
      telemetry.flush();
      if (mode === "practice") {
        setLastCorrect(Boolean(data.correct));
        setPhase("feedback");
      } else {
        await goNext();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [attemptId, item, answer, mode, goNext, telemetry]);

  if (phase === "start") {
    return (
      <div id="quiz-start" className="space-y-4">
        <p className="text-muted-foreground">
          {quiz.items.length} questions. Practice mode shows how you did after each one. Graded mode shows your results at the end.
        </p>
        <div className="flex gap-3">
          <Button id="start-practice" onClick={() => start("practice")} disabled={busy}>
            Start practice
          </Button>
          <Button id="start-graded" variant="outline" onClick={() => start("graded")} disabled={busy}>
            Start graded quiz
          </Button>
        </div>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
    );
  }

  if (phase === "done" && summary) {
    return (
      <div id="quiz-done" className="space-y-4">
        <h2 className="text-xl font-semibold">Submitted</h2>
        <p id="quiz-score">
          You got {summary.score} of {summary.total}.
        </p>
        <ol className="list-decimal space-y-1 pl-6">
          {summary.results.map((r, i) => (
            <li key={r.itemId} data-item-id={r.itemId} data-correct={r.correct}>
              Question {i + 1}: {r.answered ? (r.correct ? "correct" : "worth another look") : "skipped"}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <form
      id="quiz-item-form"
      data-attempt-id={attemptId ?? ""}
      data-mode={mode}
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (phase === "answering") submit();
        else goNext();
      }}
    >
      <div className="space-y-2">
        <p id="item-progress" className="text-sm text-muted-foreground">
          Question {index + 1} of {quiz.items.length} · {mode === "practice" ? "Practice" : "Graded"}
        </p>
        <Progress value={(index / quiz.items.length) * 100} aria-hidden="true" />
      </div>
      <Card>
        <CardContent>
          <ItemView key={item.id} item={item} value={answer} onChange={changeAnswer} disabled={phase !== "answering" || busy} />
        </CardContent>
      </Card>

      {phase === "feedback" && lastCorrect !== null && (
        <p id="item-feedback" role="status" data-correct={lastCorrect} className={lastCorrect ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}>
          {lastCorrect ? "Correct." : "Not quite. Worth a second look before the graded quiz."}
        </p>
      )}
      {error && <p role="alert" className="text-destructive">{error}</p>}

      {phase === "answering" ? (
        <Button id="submit-answer" type="submit" disabled={busy || isEmpty(answer)}>
          {mode === "graded" && isLast ? "Submit quiz" : "Submit answer"}
        </Button>
      ) : (
        <Button id={isLast ? "finish-quiz" : "next-item"} type="submit">
          {isLast ? "See results" : "Next question"}
        </Button>
      )}
    </form>
  );
}
