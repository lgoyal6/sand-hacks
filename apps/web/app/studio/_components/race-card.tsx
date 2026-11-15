"use client";
// "Rewrite race" card (owner: B), per D's direction-A spec: one lane per version, each on its own
// Neon branch; passed checks are green bars, a failed check is an X icon plus the reason in muted ink, losers fade,
// the survivor's block offers the merge. No red anywhere.
import { ExternalLink, GitBranch, X } from "lucide-react";
import { PillButton } from "@/components/ui/chat";
import { cn } from "@/lib/utils";
import type { CheckState, RaceData, RaceLane } from "../_lib/race";

const pct = (x: number) => `${Math.round(x * 100)}%`;

function Cell({ c, survivor, last }: { c: CheckState; survivor?: boolean; last?: boolean }) {
  if (c.state === "passed") {
    return (
      <div className="flex flex-col gap-1">
        <span className={cn("h-2 w-full rounded-full", survivor && last ? "bg-brand" : "bg-verified")} aria-label="passed" />
      </div>
    );
  }
  if (c.state === "failed") {
    return (
      <span className="flex items-start gap-1 text-[11px] leading-snug text-muted-foreground" title={c.detail}>
        <X className="mt-px size-3 shrink-0" aria-label="failed" />
        <span className="line-clamp-2">{shorten(c.detail)}</span>
      </span>
    );
  }
  if (c.state === "pending") {
    return (
      <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground" title={c.detail}>
        {c.detail ? `Not measured: ${shorten(c.detail)}` : "…"}
      </span>
    );
  }
  return <span className="text-[11px] text-muted-foreground/60">not reached</span>;
}

/** Keep the reason's gist: drop "not verified:" prefixes and long judge transcripts. */
function shorten(s?: string) {
  if (!s) return "";
  return s.replace(/^not verified:\s*/i, "").replace(/\s*\|.*$/, "").slice(0, 90);
}

function SolveRate({ r }: { r: RaceLane["checks"]["agentSolveRate"] }) {
  if (!r.measured) return <span className="text-[11px] text-muted-foreground/70">{r.note ? "not measured" : "not run"}</span>;
  return (
    <span className="num text-[11px] text-muted-foreground">
      {r.correct}/{r.runs} solved{r.ci95 ? ` · CI ${pct(r.ci95[0])}-${pct(r.ci95[1])}` : ""}
    </span>
  );
}

function Lane({ lane, survivorId }: { lane: RaceLane; survivorId?: string }) {
  const isSurvivor = lane.id === survivorId;
  const lost = lane.status === "rejected";
  return (
    <div className={cn("grid grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] items-center gap-3 px-4 py-2.5", lost && "opacity-45")}>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{lane.label}</p>
        <p className="flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground">
          <GitBranch className="size-3 shrink-0" />
          {lane.branch}
          {lane.branchId ? <span className="text-muted-foreground/70"> · {lane.branchId}</span> : null}
          {lane.branchLive ? "" : lost ? " · pruned" : ""}
        </p>
        {lane.parent || lane.consoleUrl ? (
          <p className="num flex items-center gap-2 truncate text-[11px] text-muted-foreground">
            {lane.parent ? <span className="truncate">from {lane.parent.name}{lane.parent.lsn ? ` @ ${lane.parent.lsn}` : ""}</span> : null}
            {lane.consoleUrl ? (
              <a href={lane.consoleUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-0.5 underline-offset-2 hover:text-foreground hover:underline">
                Neon console <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
          </p>
        ) : null}
      </div>
      <Cell c={lane.checks.sameAnswer} />
      <Cell c={lane.checks.sameSkill} />
      <Cell c={lane.checks.notOnline} survivor={isSurvivor} last />
      <SolveRate r={lane.checks.agentSolveRate} />
    </div>
  );
}

export function RaceCard({ data, onMerge }: { data: RaceData; onMerge?: (id: string) => Promise<void> }) {
  const s = data.survivor;
  return (
    <div className="overflow-hidden rounded-[20px] border border-border bg-background">
      <div className="px-4 pb-2 pt-3.5">
        <p className="text-[15px] font-medium">{data.title}</p>
        <p className="text-xs text-muted-foreground">{data.note}</p>
      </div>
      <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] gap-3 border-y border-border bg-muted/30 px-4 py-1.5 text-[11px] font-medium text-muted-foreground">
        <span>Version</span>
        <span>Same answer ×3</span>
        <span>Same skill</span>
        <span>Not online</span>
        <span>Agent solve rate</span>
      </div>
      <div className="divide-y divide-border">
        {data.lanes.map((l) => (
          <Lane key={l.id} lane={l} survivorId={s?.id} />
        ))}
      </div>
      {s ? (
        <div className="m-3 rounded-2xl bg-brand-soft px-4 py-3">
          <p className="text-sm leading-relaxed">{s.stem}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {s.agents ? (
              <p className="num text-xs text-muted-foreground">
                Agent solve rate {s.agents}
                {s.was ? ` (original ${s.was})` : ""}, for information
              </p>
            ) : null}
            {s.status === "verified" ? <span className="text-xs font-medium text-verified">Ready: same answer, same skill, not online</span> : null}
            {s.status === "verified" && onMerge ? (
              <PillButton variant="primary" className="ml-auto" onClick={() => onMerge(s.id)}>
                Merge into the quiz
              </PillButton>
            ) : s.status === "approved" ? (
              <span className="ml-auto text-xs font-medium text-verified">Merged</span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          No version passed every check yet{data.baseline ? `. Agents solved the original ${data.baseline.correct}/${data.baseline.runs} (${data.baseline.model.replace(/^gmi:google\//, "")})` : ""}. This question gets a think-aloud probe instead.
        </p>
      )}
    </div>
  );
}
