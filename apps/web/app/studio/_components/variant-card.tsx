"use client";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { strategyLabel, type CardStatus, type VariantCard as Card } from "../_lib/agents";

const STATUS: Record<CardStatus, { label: string; className: string }> = {
  generating: { label: "Writing", className: "bg-muted text-muted-foreground" },
  checking: { label: "Checking", className: "bg-agent-soft text-agent" },
  "re-attacking": { label: "Re-testing with agents", className: "bg-agent-soft text-agent" },
  verified: { label: "Verified", className: "bg-verified-soft text-verified" },
  approved: { label: "Approved", className: "bg-verified-soft text-verified" },
  rejected: { label: "Rejected", className: "bg-rejected-soft text-rejected" },
  unverified: { label: "Not verified", className: "bg-muted text-muted-foreground" },
};

function questionLabel(itemId: string) {
  const q = itemId.match(/-q(\d+)$/)?.[1];
  return q ? `Q${q}` : itemId;
}

export function VariantCard({ card, onApprove }: { card: Card; onApprove?: (id: string, approve: boolean) => Promise<void> }) {
  const [open, setOpen] = useState(card.status === "verified");
  const [busy, setBusy] = useState(false);
  const s = STATUS[card.status];
  const c = card.experiment?.candidate;
  const key = c ? (Array.isArray(c.answerKey) ? c.answerKey : [c.answerKey]) : [];
  const newRate = card.experiment?.checks.newSolveRate;

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">
              {questionLabel(card.itemId)} variant {card.k}
            </span>
            <span className="text-muted-foreground">· {strategyLabel(card.strategy)}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.className}`}>{s.label}</span>
            {newRate != null ? <span className="num text-xs text-muted-foreground">agents {Math.round(newRate * 100)}%</span> : null}
          </div>
          {card.reason ? <p className="mt-1 text-sm text-muted-foreground">{card.reason}</p> : null}
          {c ? (
            <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => setOpen((o) => !o)}>
              {open ? "Hide question" : "Show question"}
            </button>
          ) : null}
        </div>
        {card.status === "verified" || card.status === "approved" ? (
          <Button
            size="sm"
            variant={card.status === "approved" ? "outline" : "default"}
            disabled={busy || !onApprove}
            onClick={async () => {
              setBusy(true);
              try {
                await onApprove?.(card.id, card.status === "verified");
              } finally {
                setBusy(false);
              }
            }}
          >
            {card.status === "approved" ? "Undo approval" : "Approve"}
          </Button>
        ) : null}
      </div>

      {open && c ? (
        <div className="mt-3 space-y-2 border-t pt-3 text-sm">
          <p className="whitespace-pre-wrap">{c.stem}</p>
          {c.choices?.length ? (
            <ul className="space-y-1">
              {c.choices.map((ch) => (
                <li key={ch.id} className={key.includes(ch.id) ? "font-medium text-verified" : ""}>
                  {ch.id}) {ch.text}
                  {key.includes(ch.id) ? " (key)" : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              Key: <span className="num">{key.join(", ")}</span>
            </p>
          )}
          {card.rationale ? <p className="text-xs text-muted-foreground">Rewriter: {card.rationale}</p> : null}
          {card.checks.length ? (
            <ul className="space-y-1 pt-1">
              {card.checks.map((ck, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  {ck.passed ? <Check className="size-3.5 shrink-0 text-verified" /> : <X className="size-3.5 shrink-0 text-rejected" />}
                  <span>
                    <span className="font-medium">{ck.label}</span>
                    {ck.detail ? <span className="text-muted-foreground">: {ck.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
