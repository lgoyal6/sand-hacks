// Owner: C. Student quiz runtime.
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AppShell, STUDENT_COURSE_NAV } from "@/components/ui/app-shell";
import { QuizRunner } from "@/components/quiz/quiz-runner";
import { getQuiz, toPublic } from "../_lib/quizzes";
import { COURSE } from "../../_lib/course";

async function QuizBody({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const quiz = await getQuiz(id);
  if (!quiz) notFound();
  const pub = toPublic(quiz);
  return (
    <AppShell
      course={{ name: COURSE.name, term: COURSE.term, nav: STUDENT_COURSE_NAV }}
      breadcrumbs={[{ label: COURSE.name, href: "/course" }, { label: "Quizzes", href: "/course/quizzes" }, { label: pub.title }]}
      title={pub.title}
    >
      <h1 id="quiz-title" className="sr-only">{pub.title}</h1>
      <div className="max-w-3xl">
        <QuizRunner quiz={pub} suggestedMode={sp.mode === "graded" ? "graded" : "practice"} />
      </div>
    </AppShell>
  );
}

export default function QuizPage({ params, searchParams }: PageProps<"/quiz/[id]">) {
  return (
    <Suspense fallback={<p className="p-8 text-muted-foreground">Loading quiz...</p>}>
      <QuizBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}
