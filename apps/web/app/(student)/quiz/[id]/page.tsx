// Owner: C. Placeholder until the quiz runtime lands.
import { Suspense } from "react";

async function QuizBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <p className="text-muted-foreground">Quiz <code>{id}</code> is loading soon.</p>;
}

export default function QuizPage({ params }: PageProps<"/quiz/[id]">) {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Quiz</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading quiz...</p>}>
        <QuizBody params={params} />
      </Suspense>
    </section>
  );
}
