// Owner: C. Student quiz runtime, as a chat with the tutor.
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ChatQuiz } from "@/components/quiz/chat-quiz";
import { getViewer } from "@/lib/auth/server";
import { listQuizzes, toPublic } from "../_lib/quizzes";
import { LoadingShell, PageLoader } from "@/components/ui/page-loader";

async function QuizBody({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [raw, viewer] = await Promise.all([listQuizzes(), getViewer()]);
  const all = raw.map(toPublic);
  const found = all.find((q) => q.id === id);
  if (!found) notFound();
  // "Practice this" from /progress: a short session on just those items.
  const focus = typeof sp.focus === "string" ? new Set(sp.focus.split(",")) : null;
  const focused = focus ? found.items.filter((i) => focus.has(i.id)) : [];
  const pub = focused.length ? { ...found, items: focused } : found;
  const quizzes = all.map((q) => (q.id === pub.id ? pub : q));
  const student = typeof sp.student === "string" && /^[\w-]{1,64}$/.test(sp.student) ? sp.student : undefined;
  return (
    <>
      <h1 id="quiz-title" className="sr-only">{pub.title}</h1>
      <ChatQuiz quizzes={quizzes} initialQuizId={pub.id} viewer={viewer ? { name: viewer.name, role: viewer.role } : null} suggestedMode={sp.mode === "graded" ? "graded" : "practice"} voiceRequired={sp.voice === "required"} student={student} />
    </>
  );
}

export default function QuizPage({ params, searchParams }: PageProps<"/quiz/[id]">) {
  return (
    <Suspense fallback={<Suspense fallback={<PageLoader title="Loading the quiz" subtitle="Getting your questions ready" />}><LoadingShell title="Loading the quiz" subtitle="Getting your questions ready" /></Suspense>}>
      <QuizBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}
