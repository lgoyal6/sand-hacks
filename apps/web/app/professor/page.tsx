import { AppShell, PROFESSOR_COURSE_NAV } from "@/components/ui/app-shell";
import { EmptyState } from "@/components/ui/empty-state";

export default function Page() {
  return (
    <AppShell
      course={{ name: "Intro Statistics", term: "Fall 2026", nav: PROFESSOR_COURSE_NAV }}
      breadcrumbs={[{ label: "Intro Statistics", href: "/course" }, { label: "Grades" }]}
      title="Grades and insights"
    >
      <EmptyState
        title="No quiz attempts yet"
        description="Once students take a quiz, you'll see who can explain their answers, which questions agents solve, and any questions found online."
        actions={[
          { label: "Open Studio", href: "/studio", primary: true },
          { label: "View quizzes", href: "/course/quizzes" },
        ]}
      />
    </AppShell>
  );
}
