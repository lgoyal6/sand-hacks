"use client";
// "Show what a student saw" (owner: B): pick an attempt, then a short-lived Neon branch at the moment it
// started shows the quiz and answer key exactly as that student saw them (D's AppealCard renders it).
import { useEffect, useState } from "react";
import { PillButton, Thinking } from "@/components/ui/chat";
import { AppealCard } from "@/components/dashboard/appeal-card";
import type { AppealData } from "../_lib/timetravel";

type Attempt = { attemptId: string; student: string; mode: string; startedAt: string; answered: number; replayable: boolean };

export function AppealPicker({ quizId }: { quizId: string }) {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [data, setData] = useState<AppealData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {attempts.map((a) => (
          <PillButton key={a.attemptId} variant="secondary" disabled={!a.replayable || !!busy} onClick={() => void open(a)} title={a.replayable ? undefined : "No snapshot point was recorded for this attempt"}>
            {a.student} · {new Date(a.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {a.answered} answered
          </PillButton>
        ))}
      </div>
      {busy ? <Thinking label={`Branching Neon at the moment ${busy} started`} /> : null}
      {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
      {data ? <AppealCard data={data} /> : null}
    </div>
  );
}
