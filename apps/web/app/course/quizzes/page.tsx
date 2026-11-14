// Owner: C.
import { AppShell, STUDENT_COURSE_NAV } from "@/components/ui/app-shell";
import { AssignmentList } from "@/components/course/assignment-list";
import { ASSIGNMENTS, COURSE } from "@/app/(student)/_lib/course";

export default function QuizzesPage() {
  return (
    <AppShell
      course={{ name: COURSE.name, term: COURSE.term, nav: STUDENT_COURSE_NAV }}
      breadcrumbs={[{ label: COURSE.name, href: "/course" }, { label: "Quizzes" }]}
      title="Quizzes"
    >
      <div className="max-w-3xl">
        <AssignmentList items={ASSIGNMENTS.filter((a) => a.quizId)} />
      </div>
    </AppShell>
  );
}
