// Owner: C. Home: the chat's empty state ("What are we learning today?"). Picking a chip starts a quiz in place.
import { Suspense } from "react";
import { ChatQuiz } from "@/components/quiz/chat-quiz";
import { getViewer } from "@/lib/auth/server";
import { listQuizzes, toPublic } from "./(student)/quiz/_lib/quizzes";
import { LoadingShell } from "@/components/ui/page-loader";

async function Home() {
  const [all, viewer] = await Promise.all([listQuizzes(), getViewer()]);
  const quizzes = all.map(toPublic);
  if (!quizzes.length) return <p className="p-8 text-muted-foreground">No quizzes are loaded yet.</p>;
  return <ChatQuiz quizzes={quizzes} startEmpty viewer={viewer ? { name: viewer.name, role: viewer.role } : null} />;
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingShell title="Loading your classes" subtitle="Getting your quizzes ready" />}>
      <Home />
    </Suspense>
  );
}
