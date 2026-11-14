// Owner: C. Course home: what's due.
import { AppShell, STUDENT_COURSE_NAV } from "@/components/ui/app-shell";
import { AssignmentList } from "@/components/course/assignment-list";
import { ASSIGNMENTS, COURSE } from "@/app/(student)/_lib/course";

export default function CourseHome() {
  const upcoming = [...ASSIGNMENTS].sort((a, b) => a.due.localeCompare(b.due));
  return (
    <AppShell course={{ name: COURSE.name, term: COURSE.term, nav: STUDENT_COURSE_NAV }} breadcrumbs={[{ label: COURSE.name }]} title={COURSE.name}>
      <div className="max-w-3xl space-y-8">
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Coming up</h2>
          <AssignmentList items={upcoming} />
        </section>
        <section className="space-y-2 text-sm text-muted-foreground">
          <h2 className="text-lg font-semibold text-foreground">How quizzes work here</h2>
          <p>
            Some questions end with a short think-aloud: rate how sure you are, explain your reasoning in your own words, and answer one &quot;what if&quot;
            question. It takes about a minute, you can type instead of talking, and it&apos;s graded on your reasoning, never on wording or accent.
          </p>
          <p>Practice quizzes are unlimited. Use them to find what to review before the graded one.</p>
        </section>
      </div>
    </AppShell>
  );
}
