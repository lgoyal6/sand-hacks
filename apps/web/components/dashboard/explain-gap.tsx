import type { ExplainGapCell } from "@unprompted/shared";
import { cn } from "@/lib/utils";

export type Quadrant = ExplainGapCell["quadrant"];

/** Build plan 4.5: explain gap = correct AND understanding <= 1. "Explained" means a council score of 2 or more. */
export function quadrantOf(correct: boolean, understanding: number | null): Quadrant | null {
  if (understanding == null) return null;
  const explained = understanding >= 2;
  if (correct) return explained ? "correct_explained" : "explain_gap";
  return explained ? "near_miss" : "wrong_unexplained";
}

export const QUADRANTS: { id: Quadrant; title: string; hint: string; glyph: string; cls: string }[] = [
  { id: "correct_explained", title: "Correct and explained", hint: "Understanding shows", glyph: "✓", cls: "bg-understood-soft text-understood" },
  { id: "explain_gap", title: "Correct, not explained", hint: "The explain gap: suggest a follow-up chat", glyph: "◐", cls: "bg-gap-soft text-gap" },
  { id: "near_miss", title: "Wrong, but explained", hint: "Near miss: the reasoning is there", glyph: "↺", cls: "bg-near-miss-soft text-near-miss" },
  { id: "wrong_unexplained", title: "Wrong, not explained", hint: "Review the topic", glyph: "·", cls: "bg-unexplained-soft text-unexplained" },
];

export function QuadrantSummary({ cells }: { cells: ExplainGapCell[] }) {
  const counts = new Map<Quadrant, number>();
  for (const c of cells) counts.set(c.quadrant, (counts.get(c.quadrant) ?? 0) + 1);
  return (
    <div className="grid grid-cols-2 gap-2">
      {QUADRANTS.map((q) => (
        <div key={q.id} className={cn("rounded-md px-3 py-2.5", q.cls)}>
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium">{q.title}</span>
            <span className="num text-xl font-semibold">{counts.get(q.id) ?? 0}</span>
          </div>
          <p className="mt-0.5 text-[11px] opacity-80">{q.hint}</p>
        </div>
      ))}
    </div>
  );
}

/** Student x question grid. Each cell carries a glyph as well as a color. */
export function ExplainGapGrid({
  students,
  items,
  cells,
  correctness,
}: {
  students: string[];
  items: { id: string; label: string }[];
  cells: ExplainGapCell[];
  /** Correctness for answers that were not probed (shown as plain right/wrong). */
  correctness: Map<string, boolean>;
}) {
  const byKey = new Map(cells.map((c) => [`${c.studentPseudonym}|${c.itemId}`, c]));
  const meta = new Map(QUADRANTS.map((q) => [q.id, q]));
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th className="text-left text-xs font-medium text-muted-foreground">Student</th>
            {items.map((it) => (
              <th key={it.id} className="num w-12 text-center text-xs font-medium text-muted-foreground">
                {it.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s}>
              <td className="num pr-3 text-xs">{s}</td>
              {items.map((it) => {
                const c = byKey.get(`${s}|${it.id}`);
                if (c) {
                  const q = meta.get(c.quadrant)!;
                  return (
                    <td key={it.id} className={cn("h-9 w-12 rounded-md text-center font-semibold", q.cls)} title={`${q.title} · explanation ${c.understanding}/4`}>
                      {q.glyph}
                    </td>
                  );
                }
                const correct = correctness.get(`${s}|${it.id}`);
                return (
                  <td
                    key={it.id}
                    className="h-9 w-12 rounded-md border border-border text-center text-xs text-muted-foreground"
                    title={correct == null ? "Not answered" : `${correct ? "Correct" : "Wrong"}, not probed`}
                  >
                    {correct == null ? "" : correct ? "R" : "W"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">Cells without a color were not probed: R right, W wrong.</p>
    </div>
  );
}
