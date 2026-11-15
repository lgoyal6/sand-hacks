"use client";
// Leak radar card (owner: D). One row per question: where it appears online (site chips), match strength,
// evidence on click, and a "new since release" badge from the archive watch. Renders inside the chat thread
// (B's Leak scout) or standalone on /professor. Honest by design: partial matches are labelled as such.
import * as React from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { onlineCount, type LeakHit, type LeakRadarData } from "./leak-radar-data";

export type { LeakRadarData } from "./leak-radar-data";
export { buildLeakRadar } from "./leak-radar-data";

const SITE_NAMES: Record<string, string> = {
  "quizlet.com": "Quizlet",
  "chegg.com": "Chegg",
  "coursehero.com": "Course Hero",
  "brainly.com": "Brainly",
  "studocu.com": "Studocu",
  "reddit.com": "Reddit",
  "vaia.com": "Vaia",
  "transtutors.com": "Transtutors",
  "numerade.com": "Numerade",
  "bartleby.com": "bartleby",
};
const siteName = (h: string) => SITE_NAMES[Object.keys(SITE_NAMES).find((k) => h === k || h.endsWith("." + k)) ?? ""] ?? h;

function SiteChips({ hits }: { hits: LeakHit[] }) {
  const groups = new Map<string, { n: number; partial: boolean }>();
  for (const h of hits) {
    const k = siteName(h.host);
    const g = groups.get(k) ?? { n: 0, partial: true };
    g.n++;
    g.partial = g.partial && h.partial;
    groups.set(k, g);
  }
  return (
    <span className="flex flex-wrap justify-end gap-1.5">
      {[...groups.entries()].map(([name, g]) => (
        <span
          key={name}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium",
            g.partial ? "border border-dashed border-leak/40 text-leak/90" : "bg-leak-soft text-leak",
          )}
          title={g.partial ? "Shares a phrase with the question; may be a different question" : undefined}
        >
          {name}
          {g.n > 1 && <span className="num ml-1 opacity-70">{g.n}</span>}
          {g.partial && <span className="ml-1 font-normal">· partial</span>}
        </span>
      ))}
    </span>
  );
}

function Evidence({ hit }: { hit: LeakHit }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-xl bg-muted/50 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{siteName(hit.host)}</span>
        <span className="num">match {hit.matchScore.toFixed(2)}</span>
        <span>· {hit.via === "archive" ? "web archive" : "web search"}</span>
        <span>· {new Date(hit.foundAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
        {hit.partial && <span className="text-leak">· partial match, check it</span>}
      </div>
      <p className="text-sm leading-relaxed text-foreground/85">{hit.snippet}</p>
      <div className="flex flex-wrap gap-3 text-xs">
        <a href={hit.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-brand hover:underline">
          Open page <ExternalLink className="size-3" />
        </a>
        {hit.screenshotUrl && (
          <a href={hit.screenshotUrl} target="_blank" rel="noreferrer noopener" className="text-brand hover:underline">
            Screenshot
          </a>
        )}
      </div>
    </li>
  );
}

export function LeakRadar({ data, className }: { data: LeakRadarData; className?: string }) {
  const [open, setOpen] = React.useState<string | null>(null);
  const online = onlineCount(data);
  const found = data.items.filter((i) => i.hits.length);
  const clean = data.items.filter((i) => !i.hits.length);
  const fresh = data.items.filter((i) => i.newSinceRelease).length;

  return (
    <section aria-label="Leak radar" className={cn("overflow-hidden rounded-[20px] border border-border bg-card", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[18px] py-4">
        <span className="text-base font-semibold">
          {online === 0 ? "None of the questions were found online" : `${online} of ${data.itemsTotal} questions are online`}
        </span>
        <span className="text-xs text-muted-foreground">
          Web search{data.archiveWatch.status === "on" ? " · web archive watch" : ""}
        </span>
      </div>

      {found.map((it, i) => {
        const expanded = open === it.itemId;
        const best = it.hits[0];
        return (
          <div key={it.itemId} className={cn(i > 0 && "border-t border-muted")}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : it.itemId)}
              className="grid w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 px-[18px] py-3.5 text-left transition-colors hover:bg-muted/40"
            >
              <span className="num text-xs text-muted-foreground">{it.label}</span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-2 text-sm">
                  <span className="truncate">{it.topic}</span>
                  {it.newSinceRelease && <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">New since release</span>}
                </span>
                <span className="truncate text-[13px] text-muted-foreground">
                  {best.partial ? "Same phrase, maybe a different question. Worth a look." : best.snippet}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <SiteChips hits={it.hits} />
                <span className="num text-xs text-muted-foreground">{best.matchScore.toFixed(2)}</span>
                <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
              </span>
            </button>
            {expanded && (
              <ul className="space-y-2 px-[18px] pb-4 pl-[74px]">
                {it.hits.map((h) => (
                  <Evidence key={h.url} hit={h} />
                ))}
              </ul>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border bg-muted/30 px-[18px] py-3 text-xs text-muted-foreground">
        {clean.length > 0 && <span>{clean.map((c) => c.label).join(", ")} not found.</span>}
        <span>New since release: {fresh ? fresh : "none yet"}.</span>
        {data.archiveWatch.status === "on" && (
          <span>
            Archive watch (last 24h
            {data.archiveWatch.lastRunAt ? `, ran ${new Date(data.archiveWatch.lastRunAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}):{" "}
            {data.items.reduce((n, i) => n + (i.archiveCandidates ?? 0), 0) || "no"} candidate page
            {data.items.reduce((n, i) => n + (i.archiveCandidates ?? 0), 0) === 1 ? "" : "s"}.
          </span>
        )}
        <span>Snippets and links only; we never store answer content.</span>
      </div>
    </section>
  );
}
