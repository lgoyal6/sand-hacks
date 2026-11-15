"use client";
// Approve a think-aloud score (owner: D). Optimistic, reverts on failure.
import * as React from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ApproveButton({ probeId, approved: initial, score }: { probeId: string; approved: boolean; score: number }) {
  const [approved, setApproved] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function toggle() {
    const next = !approved;
    setBusy(true);
    setError(null);
    setApproved(next);
    try {
      const r = await fetch(`/professor/api/probes/${encodeURIComponent(probeId)}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: next }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
    } catch (e) {
      setApproved(!next);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      {approved ? (
        <>
          <span className="inline-flex items-center gap-1 rounded-full bg-understood-soft px-2 py-0.5 text-xs font-medium text-understood">
            <Check className="size-3" /> Approved {score}/4
          </span>
          <button type="button" onClick={toggle} disabled={busy} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            Undo
          </button>
        </>
      ) : (
        <Button size="sm" onClick={toggle} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Approve {score}/4
        </Button>
      )}
      {error && <span className="text-xs text-rejected">{error}</span>}
    </span>
  );
}
