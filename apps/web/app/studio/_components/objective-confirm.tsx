"use client";
// Confirm learning objective (owner: B). A Canvas import can only guess what a question tests (its title or a
// stem excerpt). The rewriter and the judge panel hold the objective fixed, so before a rewrite the professor
// confirms or edits it here; the confirmed text is saved on the item and the workflow refuses unconfirmed ones.
import { useEffect, useRef, useState } from "react";
import { PillButton } from "@/components/ui/chat";

type Objective = { itemId: string; objective: string; source: "inferred" | "professor" | null };

const field = "h-9 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ObjectiveConfirm({ itemId, label, onConfirmed }: { itemId: string; label: string; onConfirmed: (objective: string) => void }) {
  const [obj, setObj] = useState<Objective | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const fired = useRef(false);

  const confirmed = (objective: string) => {
    if (fired.current) return;
    fired.current = true;
    setDone(objective);
    onConfirmed(objective);
  };

  useEffect(() => {
    let live = true;
    fetch(`/studio/api/objective?item=${encodeURIComponent(itemId)}`)
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Objective & { error?: string };
        if (!live) return;
        if (!r.ok) return setError(j.error ?? `Couldn't load the objective (${r.status}).`);
        setObj(j);
        setText(j.objective);
        // Already written or confirmed by the professor: nothing to ask, start the rewrite.
        if (j.source !== "inferred") confirmed(j.objective);
      })
      .catch(() => live && setError("Lost the connection while loading the objective."));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/studio/api/objective", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId, objective: text }) });
      const j = (await r.json().catch(() => ({}))) as Objective & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `Couldn't save (${r.status}).`);
      confirmed(j.objective);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p className="text-sm">
        Learning objective for {label}: <strong>{done}</strong>. The rewrite and the judges keep this fixed.
      </p>
    );
  }
  if (error && !obj) return <p className="text-sm text-muted-foreground">{error}</p>;
  if (!obj) return <p className="text-sm text-muted-foreground">Loading the learning objective for {label}…</p>;
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">Confirm learning objective</p>
      <p className="text-xs text-muted-foreground">
        Canvas doesn&apos;t say what {label} tests, so this was guessed from its title or wording. The rewrite keeps this skill
        fixed and the judges check against it. Edit it if it&apos;s off.
      </p>
      <input className={field} value={text} maxLength={200} onChange={(e) => setText(e.target.value)} aria-label={`Learning objective for ${label}`} />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div>
        <PillButton variant="primary" disabled={busy || text.trim().length < 3} onClick={save}>
          {busy ? "Saving…" : "Confirm and write a new version"}
        </PillButton>
      </div>
    </div>
  );
}
