"use client";
// Fingerprint anchored on Solana devnet, with a live re-verify (owner: D).
import * as React from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AnchorBadgeProps {
  /** Key in data/open/anchors.json, used by /study/verify. */
  file: string;
  sha256: string;
  signature: string | null;
  label?: string;
  className?: string;
}

export function AnchorBadge({ file, sha256, signature, label = "Fingerprint", className }: AnchorBadgeProps) {
  const [state, setState] = React.useState<"idle" | "checking" | "match" | "mismatch" | "error">("idle");
  async function reverify() {
    setState("checking");
    try {
      const r = await fetch(`/study/verify?file=${encodeURIComponent(file)}`, { cache: "no-store" }).then((x) => x.json());
      setState(r.status === "match" ? "match" : r.status === "mismatch" ? "mismatch" : "error");
    } catch {
      setState("error");
    }
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground", className)}>
      <span>
        {label}: <span className="num text-foreground">{sha256.slice(0, 12)}…{sha256.slice(-6)}</span>
      </span>
      {signature ? (
        <>
          <a href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-brand hover:underline">
            Anchored on Solana devnet <ExternalLink className="size-3" aria-hidden />
          </a>
          <button type="button" onClick={reverify} disabled={state === "checking"} className="rounded-full border border-border px-2 py-0.5 hover:bg-muted disabled:opacity-50">
            {state === "checking" ? "Checking..." : "Re-verify"}
          </button>
          {state === "match" && <span className="font-medium text-verified" role="status">Matches the chain</span>}
          {state === "mismatch" && <span className="font-medium text-gap" role="status">Doesn&apos;t match: the file changed since it was anchored</span>}
          {state === "error" && <span role="status">Couldn&apos;t reach devnet right now</span>}
        </>
      ) : (
        <span>Not anchored yet</span>
      )}
    </div>
  );
}
