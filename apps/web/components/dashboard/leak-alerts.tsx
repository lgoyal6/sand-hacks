"use client";
// Leak alerts (owner: D) on B's /studio/api/alerts: a count for the sidebar badges and a calm banner on
// Studio and Insights. Opening the list marks the alerts seen. Neutral wording: a question was found online.
import * as React from "react";
import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import type { LeakAlert } from "@/app/studio/api/alerts/route";

type AlertsResponse = { unseen: number; classes: { courseId: string; courseTitle: string; alerts: LeakAlert[] }[] };

let last: AlertsResponse | null = null;
const listeners = new Set<(d: AlertsResponse) => void>();
const publish = (d: AlertsResponse) => {
  last = d;
  listeners.forEach((f) => f(d));
};

/** Unseen leak alerts for professors; refreshed on every mount. Returns null for everyone else. */
export function useLeakAlerts(enabled: boolean) {
  const [data, setData] = React.useState<AlertsResponse | null>(() => (enabled ? last : null));
  React.useEffect(() => {
    if (!enabled) return;
    let live = true;
    listeners.add(setData);
    fetch("/studio/api/alerts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: AlertsResponse | null) => live && d && publish(d))
      .catch(() => {});
    return () => {
      live = false;
      listeners.delete(setData);
    };
  }, [enabled]);
  const markSeen = React.useCallback(async (ids: string[]) => {
    if (!ids.length || !last) return;
    await fetch("/studio/api/alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => {});
    publish({ ...last, unseen: Math.max(0, last.unseen - ids.length) });
  }, []);
  return { data: enabled ? data : null, markSeen };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 questions were found online since yesterday", with View to see each one and write a new version. */
export function LeakAlertBanner({ className }: { className?: string }) {
  const { data, markSeen } = useLeakAlerts(true);
  const [open, setOpen] = React.useState(false);
  const [seenIds, setSeenIds] = React.useState<string[] | null>(null);
  const [now] = React.useState(() => Date.now());
  const alerts = (data?.classes ?? []).flatMap((c) => c.alerts.map((a) => ({ ...a, courseTitle: c.courseTitle })));
  // Keep showing what was opened, even after it is marked seen.
  const shown = seenIds ? alerts.filter((a) => seenIds.includes(a.id)) : alerts;
  if (!data || (!data.unseen && !seenIds) || !shown.length) return null;
  const n = seenIds ? shown.length : data.unseen;
  const recent = shown.every((a) => now - new Date(a.firstSeenAt).getTime() < 36 * 3600 * 1000);
  const when = recent ? "since yesterday" : "recently";
  return (
    <section aria-label="Leak alerts" className={["rounded-lg border border-leak/25 bg-leak-soft/60 text-sm", className].filter(Boolean).join(" ")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
        <span className="size-2 shrink-0 rounded-full bg-leak" aria-hidden />
        <span className="min-w-0 flex-1">
          {plural(n, "question was", "questions were")} found online {when}.
        </span>
        <button
          type="button"
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next && !seenIds) {
              const ids = alerts.map((a) => a.id);
              setSeenIds(ids);
              void markSeen(ids);
            }
          }}
          aria-expanded={open}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          {open ? "Hide" : "View"}
        </button>
        {seenIds && !open && (
          <button type="button" aria-label="Dismiss" onClick={() => setSeenIds([])} className="text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        )}
      </div>
      {open && (
        <ul className="divide-y divide-leak/15 border-t border-leak/20 bg-background/70">
          {shown.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
              <span className="num rounded-full bg-leak-soft px-2 py-0.5 text-xs font-medium text-leak">{a.label}</span>
              <span className="min-w-0 flex-1 truncate">
                {a.quizTitle}
                <span className="text-muted-foreground"> · {a.courseTitle}</span>
              </span>
              <a href={a.url} target="_blank" rel="noreferrer noopener nofollow" className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
                {a.site} <ExternalLink className="size-3" aria-hidden />
              </a>
              <Link
                href={`/studio?quiz=${encodeURIComponent(a.rewrite.quizId)}&rewrite=${encodeURIComponent(a.rewrite.itemId)}`}
                className="inline-flex h-7 items-center rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                Write a new version
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
