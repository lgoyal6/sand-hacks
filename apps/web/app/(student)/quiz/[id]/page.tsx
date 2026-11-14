// Owner: C. Student quiz runtime.
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { QuizRunner } from "@/components/quiz/quiz-runner";
import { getQuiz, toPublic } from "../_lib/quizzes";

async function QuizBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quiz = await getQuiz(id);
  if (!quiz) notFound();
  const pub = toPublic(quiz);
  return (
    <>
      <h1 id="quiz-title" className="text-2xl font-semibold">{pub.title}</h1>
      <QuizRunner quiz={pub} />
    </>
  );
}

export default function QuizPage({ params }: PageProps<"/quiz/[id]">) {
  return (
    <section className="space-y-6">
      <Suspense fallback={<p className="text-muted-foreground">Loading quiz...</p>}>
        <QuizBody params={params} />
      </Suspense>
    </section>
  );
}
