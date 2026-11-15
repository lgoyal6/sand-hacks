"use client";
// Delete a think-aloud transcript (retention). Confirmed in the page, not with a browser dialog.
import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DeleteTranscriptButton({ probeId }: { probeId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/professor/api/probes/${encodeURIComponent(probeId)}/transcript`, { method: "DELETE" });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        <Trash2 className="size-3" /> Delete transcript
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <span>Delete this transcript and its word timings for good? The score stays.</span>
      <Button size="sm" variant="destructive" onClick={remove} disabled={busy}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Delete
      </Button>
      <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="text-muted-foreground underline-offset-2 hover:underline">
        Cancel
      </button>
      {error && <span className="text-gap">{error}</span>}
    </span>
  );
}
