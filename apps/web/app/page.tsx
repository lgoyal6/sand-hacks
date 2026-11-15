// Owner: C. Home: the chat's empty state ("What are we learning today?"). Picking a chip starts a quiz in place.
import { Suspense } from "react";
import { ChatQuiz } from "@/components/quiz/chat-quiz";
import { listQuizzes, toPublic } from "./(student)/quiz/_lib/quizzes";

async function Home() {
  const quizzes = (await listQuizzes()).map(toPublic);
  if (!quizzes.length) return <p className="p-8 text-muted-foreground">No quizzes are loaded yet.</p>;
  return <ChatQuiz quizzes={quizzes} startEmpty />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="h-svh" />}>
      <Home />
    </Suspense>
  );
}
