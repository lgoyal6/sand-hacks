"use client";
// Thin presentation over GET /api/progress (all calculation is server-side in app/(student)/_lib/progress.ts),
// so a re-skin only touches this file. Mastery framing only.
import { useEffect, useState } from "react";
import { AgentAvatar } from "@/components/ui/agent-avatar";
import { SampleBadge } from "@/components/ui/sample-badge";
import { CalibrationChart } from "./calibration-chart";
import { Roadmap, type RoadmapItem } from "@/components/ui/roadmap";
import { Progress as Bar } from "@/components/ui/progress";
import { PageLoader } from "@/components/ui/page-loader";

interface Progress {
  student: string | null;
  sample: boolean;
  topics: { quizId: string; title: string; probes: number; before: number | null; after: number | null; outcome: number | null; outcomeKind: "explanation" | "answers" }[];
  review: { quizId: string; topic: string; skill: string; itemIds: string[]; reason: "unexplained" | "missed" }[];
  explainedThisWeek: number;
  streakDays: number;
  takeaway: string;
  roadmap?: RoadmapItem[];
  roadmapSummary?: { done: number; total: number; toReview: number };
}

function sessionAttemptIds(): string[] {
  try {
    return (JSON.parse(localStorage.getItem("unprompted:sessions") ?? "[]") as { id: string }[]).map((s) => s.id);
  } catch {
    return [];
  }
}

export function ProgressView({ student }: { student?: string }) {
  const [data, setData] = useState<Progress | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const qs = student ? `student=${encodeURIComponent(student)}` : `attempts=${sessionAttemptIds().join(",")}`;
    fetch(`/api/progress?${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, [student]);

  if (error) return <p className="text-muted-foreground">Progress isn&apos;t available right now.</p>;
  if (!data) return <PageLoader title="Loading your roadmap" subtitle="Gathering your quizzes and explanations" />;

  const allScored = data.topics.every((t) => t.outcomeKind === "explanation");
  return (
    <div id="progress" data-sample={data.sample} className="space-y-10">
      {data.sample && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SampleBadge /> Example of what this page shows once you&apos;ve done a few think-alouds.
        </div>
      )}

      {data.roadmapSummary && (
        <section aria-label="Overall progress" className="space-y-2">
          <p id="roadmap-summary" className="text-sm text-muted-foreground">
            {data.roadmapSummary.done} of {data.roadmapSummary.total} quizzes · {data.roadmapSummary.toReview} skill{data.roadmapSummary.toReview === 1 ? "" : "s"} to review
          </p>
          <Bar value={(data.roadmapSummary.done / Math.max(1, data.roadmapSummary.total)) * 100} aria-label="Quizzes completed" />
        </section>
      )}

      {data.roadmap && data.roadmap.length > 0 && <Roadmap title="Your roadmap" description={data.takeaway} items={data.roadmap} />}

      <section className="flex flex-wrap gap-8" aria-label="This week">
        <div>
          <p id="explained-this-week" className="text-2xl font-semibold tabular-nums">{data.explainedThisWeek}</p>
          <p className="text-sm text-muted-foreground">explained this week</p>
        </div>
        <div>
          <p id="streak-days" className="text-2xl font-semibold tabular-nums">{data.streakDays}</p>
          <p className="text-sm text-muted-foreground">{data.streakDays === 1 ? "day in a row" : "days in a row"}</p>
        </div>
      </section>

      <details className="space-y-3 rounded-xl border px-4 py-3">
        <summary id="calibration-h" className="cursor-pointer text-sm font-medium">How sure you felt, and how it went</summary>
        <div className="flex items-start gap-3">
          <AgentAvatar agent="tutor" size="sm" />
          <p id="calibration-takeaway" className="text-[15px]">{data.takeaway}</p>
        </div>
        {data.topics.length ? (
          <CalibrationChart
            rows={data.topics.map((t) => ({ id: t.quizId, label: t.title, before: t.before, after: t.after, outcome: t.outcome, note: `${t.probes} think-aloud${t.probes === 1 ? "" : "s"}` }))}
            outcomeLabel={allScored ? "Explanation score" : "Answers right"}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No think-alouds yet.</p>
        )}
        {!allScored && <p className="text-xs text-muted-foreground">Explanation scores appear once your think-alouds are reviewed; until then this shows how often those answers were right.</p>}
      </details>

    </div>
  );
}
