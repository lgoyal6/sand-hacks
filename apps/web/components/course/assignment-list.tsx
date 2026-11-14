import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { type Assignment, formatDue } from "@/app/(student)/_lib/course";

export function AssignmentList({ items }: { items: Assignment[] }) {
  return (
    <ul className="divide-y rounded-md border">
      {items.map((a) => {
        const href = a.quizId ? `/quiz/${a.quizId}${a.kind === "quiz" ? "?mode=graded" : ""}` : "#";
        return (
          <li key={a.id} id={`assignment-${a.id}`} className="flex items-start justify-between gap-4 p-4">
            <div className="space-y-1">
              <Link href={href} className="font-medium text-primary hover:underline">
                {a.title}
              </Link>
              <p className="text-sm text-muted-foreground">{a.description}</p>
              <p className="text-xs text-muted-foreground">
                Due {formatDue(a.due)} · {a.points ? `${a.points} pts` : "not graded"}
              </p>
            </div>
            <Badge variant={a.kind === "quiz" ? "default" : "secondary"}>{a.kind === "quiz" ? "Quiz" : "Practice"}</Badge>
          </li>
        );
      })}
    </ul>
  );
}
