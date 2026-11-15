// Owner: C. Student quiz runtime, as a chat with the tutor.
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ChatQuiz } from "@/components/quiz/chat-quiz";
import { getQuiz, toPublic } from "../_lib/quizzes";

async function QuizBody({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const quiz = await getQuiz(id);
  if (!quiz) notFound();
  const pub = toPublic(quiz);
  const student = typeof sp.student === "string" && /^[\w-]{1,64}$/.test(sp.student) ? sp.student : undefined;
  return (
    <>
      <h1 id="quiz-title" className="sr-only">{pub.title}</h1>
      <ChatQuiz quiz={pub} suggestedMode={sp.mode === "graded" ? "graded" : "practice"} student={student} />
    </>
  );
}

export default function QuizPage({ params, searchParams }: PageProps<"/quiz/[id]">) {
  return (
    <Suspense fallback={<div className="h-svh" />}>
      <QuizBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}
