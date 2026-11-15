// Professor studio (owner: B): a chat thread where the professor attacks a quiz,
// watches variants get written and checked, and approves survivors.
import { Suspense } from "react";
import { getStudioData } from "./_lib/data";
import { StudioChat } from "./_components/studio-chat";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading studio…</div>}>
      <Studio />
    </Suspense>
  );
}

async function Studio() {
  const data = await getStudioData("sample-stats");
  return <StudioChat data={data} />;
}
