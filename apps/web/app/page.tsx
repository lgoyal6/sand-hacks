import Link from "next/link";
import { AppShell } from "@/components/ui/app-shell";

export default function Home() {
  return (
    <AppShell title="Dashboard">
      <div className="max-w-3xl space-y-6">
        <p className="text-muted-foreground">Quizzes that test what only you have: a model of the problem in your head.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/course" className="rounded-md border p-4 hover:bg-muted">
            <p className="font-medium">Intro Statistics</p>
            <p className="text-sm text-muted-foreground">Student view: course home, quizzes, think-aloud</p>
          </Link>
          <Link href="/studio" className="rounded-md border p-4 hover:bg-muted">
            <p className="font-medium">Professor studio</p>
            <p className="text-sm text-muted-foreground">Attack a quiz, transform items, review evidence</p>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
