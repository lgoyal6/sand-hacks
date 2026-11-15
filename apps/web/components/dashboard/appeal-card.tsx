"use client";
// Time-travel appeal card (owner: D; data from B's POST /studio/api/appeal). "Show exactly what this student
// saw": the quiz as it was when the attempt started, read from a short-lived Neon branch, with the student's
// answer and today's differences. Renders inside the Studio chat thread or standalone.
import * as React from "react";
import { Check, GitBranch } from "lucide-react";
import type { AppealData, AppealItem } from "@/app/studio/_lib/timetravel";
import { cn } from "@/lib/utils";
import { PillButton } from "@/components/ui/chat/question-card";

export type { AppealData, AppealItem };

const LETTERS = "ABCDEFGH";
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null || v === "" ? [] : [String(v)]);
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "the start of the attempt";

function ItemThen({ item, index }: { item: AppealItem; index: number }) {
  const picked = asList(item.studentAnswer);
  const key = asList(item.key);
  const changed = item.changedSince;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="num">Q{index + 1}</span>
        <span className="flex items-center gap-2">
          {item.correct === true && <span className="rounded-full bg-verified-soft px-2 py-0.5 font-medium text-verified">Graded right</span>}
          {item.correct === false && <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">Graded wrong</span>}
          {changed && <span className="rounded-full bg-gap-soft px-2 py-0.5 font-medium text-gap">{changed.removed ? "Removed since" : "Changed since"}</span>}
        </span>
      </div>
      <p className="text-[15px] font-medium leading-relaxed">{item.stem}</p>

      {item.choices?.length ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {item.choices.map((c, i) => {
            const mine = picked.includes(c.id);
            const right = key.includes(c.id);
            return (
              <li
                key={c.id}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-3 py-2",
                  mine ? "border-[1.5px] border-foreground bg-muted/50" : "border-border",
                )}
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-xs text-muted-foreground">{LETTERS[i]}</span>
                <span className="flex-1">{c.text}</span>
                {mine && <span className="text-xs text-muted-foreground">their answer</span>}
                {right && (
                  <span className="flex items-center gap-1 text-xs font-medium text-verified">
                    <Check className="size-3.5" aria-hidden /> key then
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="grid gap-1.5 text-sm sm:grid-cols-2">
          <span className="rounded-xl border-[1.5px] border-foreground bg-muted/50 px-3 py-2">
            <span className="block text-xs text-muted-foreground">Their answer</span>
            {picked.join(", ") || "No answer"}
          </span>
          <span className="rounded-xl border border-border px-3 py-2">
            <span className="block text-xs text-verified">Key then</span>
            {key.join(", ")}
          </span>
        </div>
      )}

      {changed && !changed.removed && (
        <div className="space-y-2 rounded-xl bg-gap-soft/60 px-3 py-2 text-sm">
          <p className="text-xs font-medium text-muted-foreground">Changed since (branch at the attempt&apos;s start vs main today)</p>
          {changed.stem ? (
            <div className="grid gap-1.5 sm:grid-cols-2">
              <span>
                <span className="block text-xs text-muted-foreground">Question then</span>
                {item.stem}
              </span>
              <span>
                <span className="block text-xs text-muted-foreground">Question today</span>
                {changed.stem}
              </span>
            </div>
          ) : null}
          {changed.key ? (
            <p>
              <span className="text-xs text-muted-foreground">Answer key: </span>
              <span className="num">{key.join(", ")}</span> then, <span className="num font-medium">{asList(changed.key).join(", ")}</span> today
            </p>
          ) : null}
          {changed.choices ? <p className="text-xs text-muted-foreground">The answer choices changed too.</p> : null}
        </div>
      )}
    </div>
  );
}

export function AppealCard({
  data,
  itemId,
  onKeep,
  onRegrade,
  className,
}: {
  data: AppealData;
  /** Show only this question (the one being appealed). Omit to show every question. */
  itemId?: string;
  onKeep?: () => void;
  onRegrade?: () => void;
  className?: string;
}) {
  const items = itemId ? data.items.filter((i) => i.id === itemId) : data.items;
  const indexOf = (id: string) => data.items.findIndex((i) => i.id === id);
  const anyChanged = items.some((i) => i.changedSince);
  return (
    <section aria-label="Appeal" className={cn("overflow-hidden rounded-[20px] border border-border bg-card", className)}>
      <div className="flex flex-col gap-1 border-b border-border px-[18px] py-4">
        <span className="text-xs text-muted-foreground">
          Appeal · {data.student} · {data.mode}
        </span>
        <span className="text-base font-semibold">Exactly what they saw at {when(data.snapshotAt)}</span>
      </div>

      <div className="flex flex-col gap-3 bg-muted/30 p-[18px]">
        {items.map((it) => (
          <ItemThen key={it.id} item={it} index={indexOf(it.id)} />
        ))}
        {!items.length && <p className="text-sm text-muted-foreground">That question isn&apos;t in this attempt.</p>}
      </div>

      {anyChanged && (onKeep || onRegrade) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-[18px] py-3.5">
          <span className="max-w-[520px] text-sm leading-relaxed">The quiz has changed since then. This view is the version they took, not today&apos;s.</span>
          <span className="flex gap-2">
            {onKeep && (
              <PillButton variant="secondary" onClick={onKeep}>
                Keep grade
              </PillButton>
            )}
            {onRegrade && <PillButton onClick={onRegrade}>Regrade and reply</PillButton>}
          </span>
        </div>
      )}

      <div className="flex items-start gap-2 border-t border-border bg-muted/30 px-[18px] py-2.5 text-xs leading-relaxed text-muted-foreground">
        <GitBranch className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="mb-1 font-medium text-foreground/80">Where this came from (Neon time travel)</p>
          <ol className="list-decimal space-y-0.5 pl-4">
            <li>
              The attempt started {data.snapshotAt ? `at ${when(data.snapshotAt)}, ` : ""}when the database was at LSN <span className="num">{data.snapshotLsn}</span>.
            </li>
            <li>
              A temporary branch <span className="font-mono">{data.branch.name}</span>
              {data.branch.id ? <span className="num"> ({data.branch.id})</span> : null} was created from {data.branch.parent ?? "main"} at that LSN
              {data.timings.branchMs ? ` in ${(data.timings.branchMs / 1000).toFixed(1)} s` : ""}.
            </li>
            <li>
              The quiz and answer key were read there ({data.items.length} question{data.items.length === 1 ? "" : "s"}
              {data.servedFrom === "delivered_item_ids" ? ", exactly as served" : ""}); the student&apos;s answers come from main.
            </li>
            <li>
              Compared with main today: {data.changedCount === 0 ? "nothing has changed." : `${data.changedCount} question${data.changedCount > 1 ? "s" : ""} changed.`}
            </li>
            <li>{data.branch.deleted ? "The branch was deleted after the read." : "Branch deletion not confirmed yet."}</li>
          </ol>
        </div>
        <span className="num shrink-0">{(data.timings.totalMs / 1000).toFixed(1)} s</span>
      </div>
    </section>
  );
}
