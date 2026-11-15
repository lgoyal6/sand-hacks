"use client";
// Reference for the Studio chat cards (owner: D). Sample data, labelled; the real cards get data from
// B's /studio/api/appeal and the Leak scout tool.
import { AppealCard, type AppealData } from "@/components/dashboard/appeal-card";
import { SampleBadge } from "@/components/ui/sample-badge";

const base: AppealData = {
  attemptId: "att_2d548000-000",
  student: "test-c",
  quizId: "sample-stats",
  mode: "practice",
  snapshotAt: "2026-11-14T22:41:00.000Z",
  snapshotLsn: "0/1F6F668",
  branch: { name: "appeal/att_2d548000-000/sample", deleted: true },
  changedCount: 0,
  timings: { branchMs: 2200, readMs: 600, totalMs: 4000 },
  items: [
    {
      id: "sample-stats-q2",
      stem: "If the sample size quadruples and nothing else changes, the width of a 95% confidence interval for the mean:",
      type: "mcq",
      choices: [
        { id: "a", text: "doubles" },
        { id: "b", text: "halves" },
        { id: "c", text: "quarters" },
        { id: "d", text: "stays the same" },
      ],
      key: "b",
      studentAnswer: "c",
      correct: false,
      changedSince: null,
    },
  ],
};

const changed: AppealData = {
  ...base,
  changedCount: 1,
  items: [{ ...base.items[0], changedSince: { stem: "Your margin of error is 4 points. How many times more data to reach 1 point?" } }],
};

export default function Page() {
  return (
    <main className="mx-auto flex max-w-[760px] flex-col gap-8 px-6 py-10">
      <div className="flex items-center gap-2">
        <h1 className="text-[26px] font-semibold tracking-tight">Studio chat cards</h1>
        <SampleBadge />
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm text-muted-foreground">Appeal, nothing changed since</h2>
        <AppealCard data={base} itemId="sample-stats-q2" />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm text-muted-foreground">Appeal, question rewritten since</h2>
        <AppealCard data={changed} itemId="sample-stats-q2" onKeep={() => undefined} onRegrade={() => undefined} />
      </section>
    </main>
  );
}
