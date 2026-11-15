"use client";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

import type { SessionRow } from "./session-signals";
export { sessionSignals, type SessionRow } from "./session-signals";

const pct = (v: number | null) => (v == null ? "-" : `${Math.round(v * 100)}%`);

const columns: DataColumn<SessionRow>[] = [
  { accessorKey: "attemptId", header: "Session", cell: ({ getValue }) => <span className="num text-xs">{getValue() as string}</span> },
  { accessorKey: "answers", header: "Answers", size: 80, cell: ({ getValue }) => <span className="num">{getValue() as number}</span> },
  { accessorKey: "keys", header: "Keys", size: 70, cell: ({ getValue }) => <span className="num">{getValue() as number}</span> },
  { accessorKey: "clickNoMoveRatio", header: "Clicks w/o move", size: 110, cell: ({ getValue }) => <span className="num">{pct(getValue() as number | null)}</span> },
  { accessorKey: "answerNoInputRatio", header: "Answers w/o input", size: 120, cell: ({ getValue }) => <span className="num">{pct(getValue() as number | null)}</span> },
  { accessorKey: "secondsAway", header: "Time away", size: 90, cell: ({ getValue }) => <span className="num">{Math.round(getValue() as number)}s</span> },
  {
    id: "signals",
    accessorFn: (r) => r.signals.length,
    header: "What stands out",
    cell: ({ row }) =>
      row.original.signals.length ? (
        <div className="space-y-1">
          <span className="rounded-full bg-agent-soft px-2 py-0.5 text-xs font-medium text-agent">Pattern differs, suggest a follow-up chat</span>
          <ul className="list-disc pl-4 text-xs text-muted-foreground">
            {row.original.signals.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">Typical</span>
      ),
  },
];

export function SessionTable({ rows }: { rows: SessionRow[] }) {
  return <DataTable columns={columns} data={rows} initialSorting={[{ id: "signals", desc: true }]} pageSize={8} empty="No sessions recorded yet." />;
}
