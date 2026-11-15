"use client";
// Experiment tree card (owner: B): a git-style graph of a quiz's Neon branches. Calm and light:
// main down the left, one forked lane per branch, dashed when the branch was pruned. No red, no emojis.
import { useState } from "react";
import { Check, GitMerge } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NeonFacts, TreeData, TreeLane } from "../_lib/tree";

const OUTCOME: Record<TreeLane["outcome"], { label: string; dot: string; chip: string }> = {
  approved: { label: "Approved", dot: "bg-verified", chip: "bg-verified-soft text-verified" },
  verified: { label: "Ready", dot: "bg-brand", chip: "bg-brand-soft text-brand" },
  rejected: { label: "Rejected", dot: "bg-muted-foreground/40", chip: "bg-muted text-muted-foreground" },
  "not verified": { label: "Not verified", dot: "border border-muted-foreground/50 bg-background", chip: "bg-muted text-muted-foreground" },
  appeal: { label: "Appeal", dot: "bg-agent-soft border border-agent/40", chip: "bg-agent-soft text-agent" },
};

function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

function time(iso?: string) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : undefined;
}

/** Only what Neon's API reported. Nothing is estimated. */
function Facts({ f, isMain }: { f?: NeonFacts; isMain?: boolean }) {
  if (!f) return null;
  const parts: string[] = [];
  if (f.forkTimestamp) parts.push(`forked ${time(f.forkTimestamp)}`);
  if (f.forkLsn) parts.push(`LSN ${f.forkLsn}`);
  if (typeof f.logicalSizeBytes === "number") parts.push(`${bytes(f.logicalSizeBytes)} logical`);
  // "Copy-on-write" describes a child branch that shares main's pages; it doesn't apply to main itself.
  if (!isMain && typeof f.writtenBytes === "number") parts.push(f.writtenBytes === 0 ? "0 B written since fork (copy-on-write)" : `${bytes(f.writtenBytes)} written since fork`);
  return parts.length ? <p className="num truncate text-[11px] text-muted-foreground">{parts.join(" · ")}</p> : null;
}

function Lane({ lane, last }: { lane: TreeLane; last: boolean }) {
  const [open, setOpen] = useState(false);
  const o = OUTCOME[lane.outcome];
  const dashed = !lane.live;
  return (
    <li className="relative pl-12">
      {/* main line continues past this lane */}
      <span className={cn("absolute left-[11px] top-0 w-0.5 bg-border", last ? "h-5" : "h-full")} aria-hidden />
      {/* fork connector from main into the lane */}
      <span className={cn("absolute left-3 top-5 h-0 w-7 border-t-2", dashed ? "border-dashed border-muted-foreground/40" : "border-border")} aria-hidden />
      {lane.merged ? <GitMerge className="absolute left-[3px] top-[13px] size-[18px] rounded-full bg-background text-verified" aria-label="merged into main" /> : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={lane.steps.join("\n")}
        aria-expanded={open}
        className={cn("w-full rounded-xl px-2 py-2 text-left hover:bg-muted/50", lane.kind === "appeal" && "opacity-80")}
      >
        <span className="flex items-center gap-2">
          <span className={cn("size-2.5 shrink-0 rounded-full", o.dot)} aria-hidden />
          <span className="truncate text-sm font-medium">{lane.label}</span>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", o.chip)}>{o.label}</span>
          {dashed ? <span className="shrink-0 text-[11px] text-muted-foreground">pruned</span> : null}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">{lane.branch}</span>
        {lane.reason ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{lane.reason}</span> : null}
        <Facts f={lane.neon} />
      </button>
      {open ? (
        <ol className="mb-2 ml-6 space-y-1 border-l border-border pl-3">
          {lane.steps.map((s, i) => (
            <li key={i} className="flex gap-2 text-xs text-muted-foreground">
              <Check className="mt-px size-3 shrink-0" />
              {s}
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

export function TreeCard({ data }: { data: TreeData }) {
  const exp = data.lanes.filter((l) => l.kind === "experiment");
  const liveCount = data.lanes.filter((l) => l.live).length;
  return (
    <div className="overflow-hidden rounded-[20px] border border-border bg-background">
      <div className="px-4 pb-2 pt-3.5">
        <p className="text-[15px] font-medium">
          {exp.length} experiment branch{exp.length === 1 ? "" : "es"} on Neon
          {data.source.appeals ? `, ${data.source.appeals} appeal${data.source.appeals === 1 ? "" : "s"}` : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          Every rewrite runs on its own copy-on-write branch of the quiz database. {liveCount} still exist; the rest were pruned after their result was recorded on main.
          {data.source.neonApi ? "" : " Live branch details are unavailable (no Neon API key)."}
        </p>
      </div>
      <ol className="relative px-3 pb-3">
        <li className="relative flex items-center gap-2 pl-12 pt-1">
          <span className="absolute left-[7px] top-[9px] size-2.5 rounded-full bg-foreground" aria-hidden />
          <span className="absolute left-[11px] top-4 h-[calc(100%-8px)] w-0.5 bg-border" aria-hidden />
          <span className="text-sm font-medium">main</span>
          <span className="truncate">
            <Facts f={data.main.neon} isMain />
          </span>
        </li>
        {data.lanes.map((l, i) => (
          <Lane key={l.branch} lane={l} last={i === data.lanes.length - 1} />
        ))}
      </ol>
    </div>
  );
}
