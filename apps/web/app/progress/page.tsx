// Owner: C (taken over from D). Student progress: calibration, what to review, a modest streak.
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ProgressView } from "@/components/progress/progress-view";
import { getViewer } from "@/lib/auth/server";
import { AppShell } from "@/components/ui/app-shell";
import { LoadingShell } from "@/components/ui/page-loader";

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Professors don't have "Your progress"; their view is the class roster.
  if ((await getViewer())?.role === "professor") redirect("/professor/students");
  const sp = await searchParams;
  const student = typeof sp.student === "string" && /^[\w-]{1,64}$/.test(sp.student) ? sp.student : undefined;
  return <ProgressView student={student} />;
}

export default function ProgressPage({ searchParams }: PageProps<"/progress">) {
  return (
    <Suspense fallback={<LoadingShell title="Loading your progress" subtitle="Gathering your quizzes and explanations" />}>
      <AppShell title="Your progress" subtitle="What you can explain, what to review next.">
        <Body searchParams={searchParams} />
      </AppShell>
    </Suspense>
  );
}
