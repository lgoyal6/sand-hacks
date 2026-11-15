"use client";
// Thin presentation over GET /api/progress (all calculation is server-side in app/(student)/_lib/progress.ts),
// so a re-skin only touches this file. Mastery framing only.
import { useEffect, useState } from "react";
import Link from "next/link";
import { AgentAvatar } from "@/components/ui/agent-avatar";
import { SampleBadge } from "@/components/ui/sample-badge";
import { CalibrationChart } from "./calibration-chart";

interface Progress {
  student: string | null;
  sample: boolean;
  topics: { quizId: string; title: string; probes: number; before: number | null; after: number | null; outcome: number | null; outcomeKind: "explanation" | "answers" }[];
  review: { quizId: string; topic: string; skill: string; itemIds: string[]; reason: "unexplained" | "missed" }[];
  explainedThisWeek: number;
  streakDays: number;
  takeaway: string;
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
  if (!data) return <p className="text-muted-foreground">Loading your progress...</p>;

  const allScored = data.topics.every((t) => t.outcomeKind === "explanation");
  return (
    <div id="progress" data-sample={data.sample} className="space-y-10">
      {data.sample && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SampleBadge /> Example of what this page shows once you&apos;ve done a few think-alouds.
        </div>
      )}

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

      <section className="space-y-3" aria-labelledby="calibration-h">
        <h2 id="calibration-h" className="text-lg font-semibold">How sure you felt, and how it went</h2>
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
      </section>

      <section className="space-y-3" aria-labelledby="review-h">
        <h2 id="review-h" className="text-lg font-semibold">What to review</h2>
        {data.review.length ? (
          <ul className="divide-y rounded-xl border">
            {data.review.map((r) => (
              <li key={`${r.quizId}-${r.skill}`} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="text-[15px]">{r.skill.charAt(0).toUpperCase() + r.skill.slice(1)}</p>
                  <p className="text-sm text-muted-foreground">
                    {r.topic} · {r.reason === "unexplained" ? "you got it right; explaining it was harder" : "worth another try"}
                  </p>
                </div>
                <Link
                  href={`/quiz/${r.quizId}?mode=practice&focus=${r.itemIds.join(",")}`}
                  className="inline-flex h-9 shrink-0 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
                >
                  Practice this
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing flagged. Nice.</p>
        )}
      </section>
    </div>
  );
}
