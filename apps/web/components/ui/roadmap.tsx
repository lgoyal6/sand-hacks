"use client";
// Roadmap list (adapted from Dat's 21st.dev "roadmap-3" block): a card with a header and divided rows, each with a
// square action on the left, title plus status and category badges, a description, and an optional progress row
// with agent avatars and a percentage. Props-driven; uses our Card, Badge, Progress and AgentAvatar (no photos).
import Link from "next/link";
import { ChevronRight, Play } from "lucide-react";
import { AgentAvatar } from "@/components/ui/agent-avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type RoadmapStatus = "Done" | "In progress" | "Up next";

export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  category: string;
  status: RoadmapStatus;
  /** Open items (questions to explain, skills to review). Shown in the action button. */
  count: number;
  action: { label: string; href: string };
  /** 0..100, e.g. score % or explained %. */
  progress?: number;
  progressLabel?: string;
  /** AgentAvatar keys shown next to the progress bar, e.g. ["tutor", "explain-coach"]. */
  agents?: string[];
}

const statusVariant: Record<RoadmapStatus, "default" | "secondary" | "outline"> = {
  "Up next": "outline",
  "In progress": "secondary",
  Done: "default",
};

export function Roadmap({ title, description, items, className }: { title: string; description?: string; items: RoadmapItem[]; className?: string }) {
  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <ul id="roadmap" className="flex flex-col divide-y divide-border border-t border-border">
        {items.map((item) => (
          <li key={item.id} data-status={item.status} className="flex items-start gap-4 px-4 py-4 sm:px-6">
            <Link
              href={item.action.href}
              aria-label={`${item.action.label}: ${item.title}`}
              className={cn(
                "flex w-14 shrink-0 flex-col items-center gap-0.5 rounded-md border py-1.5 text-xs font-medium tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                item.status === "In progress"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {item.status === "Done" ? <ChevronRight className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
              <span>{item.count > 0 ? item.count : item.action.label}</span>
            </Link>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{item.title}</h3>
                <Badge variant={statusVariant[item.status]}>{item.status}</Badge>
                <Badge variant="secondary">{item.category}</Badge>
              </div>
              <p className="text-xs/relaxed text-muted-foreground">{item.description}</p>
              {item.progress != null && (
                <div className="mt-0.5 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-3">
                    {item.agents?.length ? (
                      <div className="flex -space-x-1.5">
                        {item.agents.map((a) => (
                          <AgentAvatar key={a} agent={a} size="sm" className="rounded-full ring-2 ring-card" />
                        ))}
                      </div>
                    ) : (
                      <span />
                    )}
                    <span className="text-xs font-medium text-muted-foreground tabular-nums">
                      {item.progressLabel ? `${item.progressLabel} · ` : ""}
                      {Math.round(item.progress)}%
                    </span>
                  </div>
                  <Progress value={item.progress} aria-label={`${item.title} progress`} />
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default Roadmap;
