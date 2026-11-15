// Students roster (owner: D). Every think-aloud score waits for the professor's approval; signals are
// suggestions for a conversation, never a verdict, and accommodations are never checked.
import { Suspense } from "react";
import { connection } from "next/server";
import { AppShell } from "@/components/ui/app-shell";
import { Kpi, Panel, PanelEmpty } from "@/components/dashboard/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { loadRoster } from "./_lib";
import { RosterTable } from "./roster-table";

export default function Page() {
  return (
    <AppShell wide title="Students" subtitle="Who has taken the quiz, how their explanations went, and what to talk about next.">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Roster />
      </Suspense>
    </AppShell>
  );
}

async function Roster() {
  await connection();
  const rows = await loadRoster().catch((e) => {
    console.error("[students] roster failed:", (e as Error).message);
    return null;
  });
  if (!rows) return <PanelEmpty>The class roster could not be loaded. Check the database connection.</PanelEmpty>;
  const people = rows.filter((r) => r.who === "human");
  const toApprove = people.reduce((a, r) => a + r.awaitingApproval, 0);
  const followUps = people.filter((r) => r.followUp).length;
  const over = people.filter((r) => r.calibration?.label === "More confident than results").length;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Students" value={people.length} sub={`${rows.length - people.length} test or agent accounts not counted`} />
        <Kpi label="Scores to approve" value={toApprove} sub="Think-aloud scores reach grades only after you approve" />
        <Kpi label="Suggested follow-ups" value={followUps} tone={followUps ? "gap" : "default"} sub="A question to ask, not a finding" />
        <Kpi label="More confident than results" value={over} sub="Confidence before answering vs. correct answers" />
      </div>
      <Panel title="Roster" description="Click a student to see each question exactly as they saw it, their think-alouds, and to approve scores.">
        <RosterTable rows={rows} />
      </Panel>
    </div>
  );
}
