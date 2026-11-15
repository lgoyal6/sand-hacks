"use client";
import type { LeakFinding } from "@unprompted/shared";
import { ExternalLink } from "lucide-react";
import { DataTable, inFacet, type DataColumn } from "@/components/ui/data-table";

export type LeakRow = LeakFinding & { itemLabel: string; host: string };

const SOURCE_LABEL: Record<string, string> = { quizlet: "Quizlet", reddit: "Reddit", chegg: "Chegg", coursehero: "Course Hero", other: "Other site" };

const columns: DataColumn<LeakRow>[] = [
  { accessorKey: "itemLabel", header: "Question", size: 80, cell: ({ getValue }) => <span className="num text-xs">{getValue() as string}</span> },
  {
    accessorKey: "sourceType",
    header: "Source",
    filterFn: inFacet,
    cell: ({ row }) => (
      <div className="min-w-0">
        <span className="rounded-full bg-leak-soft px-2 py-0.5 text-xs font-medium text-leak">{SOURCE_LABEL[row.original.sourceType]}</span>
        <p className="mt-1 truncate text-xs text-muted-foreground">{row.original.host}</p>
      </div>
    ),
  },
  {
    accessorKey: "matchScore",
    header: "Match",
    size: 110,
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return (
        <div className="flex items-center gap-2" title="Text overlap between the question and the search result, not proof it is the same question">
          <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-leak" style={{ width: `${Math.round(v * 100)}%` }} />
          </div>
          <span className="num text-xs">{v.toFixed(2)}</span>
        </div>
      );
    },
  },
  {
    accessorKey: "snippet",
    header: "Evidence (search snippet)",
    enableSorting: false,
    cell: ({ row }) => (
      <div className="max-w-xl">
        <p className="line-clamp-2 text-sm">{row.original.snippet}</p>
        <a href={row.original.url} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
          Open page <ExternalLink className="size-3" />
        </a>
      </div>
    ),
  },
  {
    accessorKey: "foundAt",
    header: "Found",
    size: 110,
    cell: ({ getValue }) => (
      <span className="num text-xs text-muted-foreground">{new Date(getValue() as string).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
    ),
  },
];

export function LeakTable({ rows }: { rows: LeakRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={rows}
      facet={{ columnId: "sourceType", label: "Source", format: (v) => SOURCE_LABEL[v] ?? v }}
      initialSorting={[{ id: "matchScore", desc: true }]}
      pageSize={8}
      empty="No matches found online."
    />
  );
}
