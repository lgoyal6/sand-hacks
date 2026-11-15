"use client";
// One variant as a compact result row inside an assistant message (owner: B).
// Static status marks only: the Agents panel is the one place that animates.
import { useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { PillButton } from "@/components/ui/chat";
import { cn } from "@/lib/utils";
import { strategyLabel, type CardStatus, type VariantCard as Card } from "../_lib/agents";

const STATUS: Record<CardStatus, { label: string; dot: string; pill: string }> = {
  generating: { label: "Writing", dot: "bg-muted-foreground/40", pill: "bg-muted text-muted-foreground" },
  checking: { label: "Checking", dot: "bg-brand", pill: "bg-brand-soft text-brand" },
  "re-attacking": { label: "Re-testing with agents", dot: "bg-brand", pill: "bg-brand-soft text-brand" },
  verified: { label: "Verified · needs your approval", dot: "bg-verified", pill: "bg-verified-soft text-verified" },
  approved: { label: "Approved", dot: "bg-verified", pill: "bg-verified-soft text-verified" },
  rejected: { label: "Rejected", dot: "bg-rejected", pill: "bg-rejected-soft text-rejected" },
  unverified: { label: "Not verified", dot: "bg-muted-foreground/40", pill: "bg-muted text-muted-foreground" },
};

function questionLabel(itemId: string) {
  const q = itemId.match(/-q(\d+)$/)?.[1];
  return q ? `Q${q}` : itemId;
}

export type Decision = "approve" | "reject" | "unapprove";

export function VariantCard({ card, onDecide, waiting }: { card: Card; onDecide?: (id: string, d: Decision) => Promise<void>; waiting?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = STATUS[card.status];
  const c = card.experiment?.candidate;
  const key = c ? (Array.isArray(c.answerKey) ? c.answerKey : [c.answerKey]) : [];
  const newRate = card.experiment?.checks.newSolveRate;
  const decide = async (d: Decision) => {
    setBusy(true);
    try {
      await onDecide?.(card.id, d);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-background">
      <div className="flex items-start gap-3 px-4 py-3">
        <span className={cn("mt-[7px] size-2 shrink-0 rounded-full", s.dot)} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-medium">
              {questionLabel(card.itemId)} · variant {card.k}
            </span>
            <span className="text-muted-foreground"> · {strategyLabel(card.strategy)}</span>
          </p>
          <p className="mt-1 text-xs">
            <span className={cn("rounded-full px-2 py-0.5 font-medium", s.pill)}>{s.label}</span>
            {waiting && card.status === "verified" ? <span className="ml-1 text-muted-foreground">· the workflow is paused for you</span> : null}
            {newRate != null ? <span className="num font-normal text-muted-foreground"> · agents solved {Math.round(newRate * 100)}%</span> : null}
          </p>
          {card.reason ? <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{card.reason}</p> : null}
        </div>
        {card.status === "verified" && onDecide ? (
          <div className="flex shrink-0 gap-2">
            <PillButton variant="secondary" disabled={busy} onClick={() => decide("reject")}>
              Reject
            </PillButton>
            <PillButton variant="primary" disabled={busy} onClick={() => decide("approve")}>
              Approve
            </PillButton>
          </div>
        ) : card.status === "approved" && onDecide ? (
          <PillButton variant="ghost" disabled={busy} onClick={() => decide("unapprove")}>
            Undo
          </PillButton>
        ) : null}
      </div>

      {c ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex w-full items-center gap-1 border-t border-border px-4 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            {open ? "Hide question" : "Show question"}
          </button>
          {open ? (
            <div className="space-y-3 border-t border-border px-4 py-3 text-sm">
              <p className="whitespace-pre-wrap leading-relaxed">{c.stem}</p>
              {c.choices?.length ? (
                <ul className="space-y-1">
                  {c.choices.map((ch) => {
                    const isKey = key.includes(ch.id);
                    return (
                      <li key={ch.id} className={cn("flex gap-2", isKey && "font-medium text-verified")}>
                        <span className="w-4 shrink-0 text-muted-foreground">{ch.id}</span>
                        <span>{ch.text}</span>
                        {isKey ? <span className="text-xs font-normal">answer key</span> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-muted-foreground">
                  Answer key: <span className="num text-foreground">{key.join(", ")}</span>
                </p>
              )}
              {card.checks.length ? (
                <ul className="space-y-1">
                  {card.checks.map((ck, i) => (
                    <li key={i} className="flex gap-2 text-xs">
                      {ck.passed ? <Check className="mt-px size-3.5 shrink-0 text-verified" /> : <X className="mt-px size-3.5 shrink-0 text-rejected" />}
                      <span className="text-muted-foreground">
                        <span className="text-foreground">{ck.label}</span>
                        {ck.detail ? `. ${ck.detail}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {card.rationale ? <p className="text-xs text-muted-foreground">Why the rewriter thinks it still fits: {card.rationale}</p> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
