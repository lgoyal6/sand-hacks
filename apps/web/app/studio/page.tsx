// Professor studio (owner: B): a chat thread where the professor attacks a quiz,
// watches variants get written and checked, and approves survivors. ?quiz=<id> picks the quiz.
import { Suspense } from "react";
import { getStudioData } from "./_lib/data";
import { StudioChat } from "./_components/studio-chat";
import { PageLoader } from "@/components/ui/page-loader";

export default function Page({ searchParams }: PageProps<"/studio">) {
  return (
    <Suspense fallback={<PageLoader title="Opening the studio" subtitle="Loading your quiz and the agents" />}>
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
