// Owner: C (taken over from D). Student progress: calibration, what to review, a modest streak.
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ProgressView } from "@/components/progress/progress-view";
import { getViewer } from "@/lib/auth/server";

async function Body({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Professors don't have "Your progress"; their view is the class roster.
  if ((await getViewer())?.role === "professor") redirect("/professor/students");
  const sp = await searchParams;
  const student = typeof sp.student === "string" && /^[\w-]{1,64}$/.test(sp.student) ? sp.student : undefined;
  return <ProgressView student={student} />;
}

export default function ProgressPage({ searchParams }: PageProps<"/progress">) {
  return (
    <main className="mx-auto w-full max-w-[760px] px-4 py-10">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">Your progress</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading your progress...</p>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
