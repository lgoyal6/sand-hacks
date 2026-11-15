"use client";
// "Show what a student saw" (owner: B): pick an attempt, then a short-lived Neon branch at the moment it
// started shows the quiz and answer key exactly as that student saw them (D's AppealCard renders it).
import { useEffect, useRef, useState } from "react";
import { PillButton, Thinking } from "@/components/ui/chat";
import { AppealCard } from "@/components/dashboard/appeal-card";
import type { AppealData } from "../_lib/timetravel";
import { studioFetch } from "../_lib/replay-client";

type Attempt = { attemptId: string; student: string; mode: string; startedAt: string; answered: number; replayable: boolean };

/** Agent runs and test accounts, hidden by default so real students come first. */
const SYNTHETIC = /^(agent|scripted|test|e2e)[-_]/i;

/**
 * attemptId: the attempt named in the URL (?view=appeal&attempt=), opened on load, so the replay survives
 * refresh and Back. onOpen: called instead of opening in place, so the caller can put the attempt in the URL.
 */
export function AppealPicker({ quizId, attemptId, onOpen }: { quizId: string; attemptId?: string | null; onOpen?: (attemptId: string) => void }) {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [data, setData] = useState<AppealData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSynthetic, setShowSynthetic] = useState(false);

  useEffect(() => {
    studioFetch(`/studio/api/attempts?quiz=${encodeURIComponent(quizId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setAttempts)
      .catch(() => setError("Couldn't load attempts."));
  }, [quizId]);

  const open = async (a: Pick<Attempt, "attemptId" | "student">) => {
    setBusy(a.student);
    setError(null);
    setData(null);
    try {
      const r = await studioFetch("/studio/api/appeal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId: a.attemptId }) });
      const j = (await r.json()) as AppealData & { error?: string };
      if (!r.ok) throw new Error(j.error ?? "Couldn't replay that attempt.");
      setData(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // The URL names an attempt: replay it (again on refresh or Back/Forward to it).
  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    if (openedRef.current === (attemptId ?? null)) return;
    // Deferred, and the ref is set only when it runs, so a StrictMode mount/unmount/mount opens exactly once.
    const t = setTimeout(() => {
      openedRef.current = attemptId ?? null;
      if (attemptId) void open({ attemptId, student: attemptId });
      else if (onOpen) setData(null); // Back from an opened attempt to the picker
    }, 0);
    return () => clearTimeout(t);
  }, [attemptId]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <PillButton key={a.attemptId} variant="secondary" disabled={!a.replayable || !!busy} onClick={() => (onOpen ? onOpen(a.attemptId) : void open(a))} title={a.replayable ? undefined : "No snapshot point was recorded for this attempt"}>
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
