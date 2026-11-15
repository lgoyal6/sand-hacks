"use client";
// "Show what a student saw" (owner: B): pick an attempt, then a short-lived Neon branch at the moment it
// started shows the quiz and answer key exactly as that student saw them (D's AppealCard renders it).
import { useEffect, useState } from "react";
import { PillButton, Thinking } from "@/components/ui/chat";
import { AppealCard } from "@/components/dashboard/appeal-card";
import type { AppealData } from "../_lib/timetravel";

type Attempt = { attemptId: string; student: string; mode: string; startedAt: string; answered: number; replayable: boolean };

/** Agent runs and test accounts, hidden by default so real students come first. */
const SYNTHETIC = /^(agent|scripted|test|e2e)[-_]/i;

export function AppealPicker({ quizId }: { quizId: string }) {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [data, setData] = useState<AppealData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSynthetic, setShowSynthetic] = useState(false);

  useEffect(() => {
    fetch(`/studio/api/attempts?quiz=${encodeURIComponent(quizId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setAttempts)
      .catch(() => setError("Couldn't load attempts."));
  }, [quizId]);

  const open = async (a: Attempt) => {
    setBusy(a.student);
    setError(null);
    setData(null);
    try {
      const r = await fetch("/studio/api/appeal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId: a.attemptId }) });
      const j = (await r.json()) as AppealData & { error?: string };
      if (!r.ok) throw new Error(j.error ?? "Couldn't replay that attempt.");
      setData(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (error && !attempts) return <p className="text-sm text-muted-foreground">{error}</p>;
  if (!attempts) return <Thinking label="Loading attempts" />;
  if (!attempts.length) return <p className="text-sm text-muted-foreground">No attempts on this quiz yet.</p>;
  const synthetic = attempts.filter((a) => SYNTHETIC.test(a.student));
  const shown = showSynthetic ? attempts : attempts.filter((a) => !SYNTHETIC.test(a.student));
  return (
    <div className="space-y-3">
      {!shown.length ? <p className="text-sm text-muted-foreground">No student attempts yet, only test and agent runs.</p> : null}
      <div className="flex flex-wrap gap-2">
        {shown.map((a) => (
          <PillButton key={a.attemptId} variant="secondary" disabled={!a.replayable || !!busy} onClick={() => void open(a)} title={a.replayable ? undefined : "No snapshot point was recorded for this attempt"}>
            {a.student} · {new Date(a.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {a.answered} answered
          </PillButton>
        ))}
      </div>
      {synthetic.length ? (
        <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowSynthetic((v) => !v)}>
          {showSynthetic ? "Hide" : "Show"} test and agent attempts ({synthetic.length})
        </button>
      ) : null}
      {busy ? <Thinking label={`Branching Neon at the moment ${busy} started`} /> : null}
      {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
      {data ? <AppealCard data={data} /> : null}
    </div>
  );
}
