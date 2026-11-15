// Professor studio (owner: B): a chat thread where the professor attacks a quiz,
// watches variants get written and checked, and approves survivors. ?quiz=<id> picks the quiz.
import { Suspense } from "react";
import { getStudioData } from "./_lib/data";
import { StudioChat } from "./_components/studio-chat";

export default function Page({ searchParams }: PageProps<"/studio">) {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading studio…</div>}>
      <Studio searchParams={searchParams} />
    </Suspense>
  );
}

async function Studio({ searchParams }: { searchParams: PageProps<"/studio">["searchParams"] }) {
  const q = (await searchParams).quiz;
  const quizId = typeof q === "string" && /^[\w-]+$/.test(q) ? q : "sample-stats";
  const data = await getStudioData(quizId);
  return <StudioChat key={quizId} data={data} />;
}
