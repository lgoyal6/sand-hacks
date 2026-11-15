// Owner: C. Home: the chat's empty state ("What are we learning today?"). Picking a chip starts the quiz in place.
import { Suspense } from "react";
import { ChatQuiz } from "@/components/quiz/chat-quiz";
import { getQuiz, toPublic } from "./(student)/quiz/_lib/quizzes";

const HOME_QUIZ = "sample-stats";

async function Home() {
  const quiz = await getQuiz(HOME_QUIZ);
  if (!quiz) return <p className="p-8 text-muted-foreground">No quiz is loaded yet.</p>;
  return <ChatQuiz quiz={toPublic(quiz)} startEmpty />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="h-svh" />}>
      <Home />
    </Suspense>
  );
}
