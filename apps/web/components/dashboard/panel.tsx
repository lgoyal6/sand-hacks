import * as React from "react";
import { cn } from "@/lib/utils";

/** Where a panel's numbers come from. Real fixture output is labelled as such, never as "sample". */
export function SourceNote({ origin, updatedAt }: { origin: "fixture" | "tiger" | "none"; updatedAt?: string }) {
  if (origin === "none") return null;
  const when = updatedAt
    ? new Date(updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";
  return (
    <span className="text-[11px] text-muted-foreground" title={origin === "tiger" ? "Live from Tiger Data" : "Producer output in data/fixtures"}>
      {origin === "tiger" ? "Live" : "From fixtures"}
      {when && ` · ${when}`}
    </span>
  );
}

export function Panel({
  title,
  description,
  meta,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-card", className)}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-5 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {meta}
          </div>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Small inline empty state for a panel whose producer hasn't written data yet. */
export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{children}</div>;
}

export function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "default" | "gap" | "leak" | "agent" }) {
  const toneClass = { default: "", gap: "text-gap", leak: "text-leak", agent: "text-agent" }[tone ?? "default"];
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("num mt-1 text-2xl font-semibold", toneClass)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
