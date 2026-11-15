"use client";
// Students roster table (owner: D). Test and agent accounts are hidden by default.
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Switch } from "@/components/ui/switch";
import type { RosterRow } from "./_lib";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

export function CalibrationText({ c }: { c: RosterRow["calibration"] }) {
  if (!c) return <span className="text-xs text-muted-foreground">Not enough think-alouds</span>;
  const tone = c.label === "Matches results" ? "text-understood" : c.label === "More confident than results" ? "text-gap" : "text-foreground";
  return (
    <span className="text-xs">
      <span className={tone}>{c.label}</span>
      {c.label !== "Matches results" && <span className="num text-muted-foreground"> ({c.gap > 0 ? "+" : ""}{c.gap} pts)</span>}
    </span>
  );
}

const columns: DataColumn<RosterRow>[] = [
  {
    accessorKey: "pseudonym",
    header: "Student",
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        {/* A real link (middle-click, new tab, keyboard); the row click is only a bigger target. */}
        <Link href={`/professor/students/${encodeURIComponent(row.original.pseudonym)}`} onClick={(e) => e.stopPropagation()} className="num rounded text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {row.original.pseudonym}
        </Link>
        {row.original.who !== "human" && <span className="rounded-full bg-agent-soft px-1.5 py-0.5 text-[10px] font-medium text-agent">{row.original.who}</span>}
        {row.original.accommodated && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">accommodation</span>}
      </span>
    ),
  },
  {
    id: "latest",
    accessorFn: (r) => (r.latest && r.latest.total ? r.latest.score / r.latest.total : -1),
    header: "Latest quiz",
    cell: ({ row }) =>
      row.original.latest ? (
        <span className="num text-xs">
          {row.original.latest.score}/{row.original.latest.total}
          <span className="ml-1.5 text-muted-foreground">{row.original.latest.mode}</span>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">none</span>
      ),
  },
  {
    accessorKey: "thinkAloudAvg",
    header: "Think-alouds",
    cell: ({ row }) => (
      <span className="num text-xs">
        {row.original.thinkAlouds}
        {row.original.thinkAloudAvg != null && <span className="ml-1.5 text-muted-foreground">avg {row.original.thinkAloudAvg}/4</span>}
      </span>
    ),
  },
  { id: "calibration", accessorFn: (r) => r.calibration?.gap ?? -999, header: "Confidence vs results", cell: ({ row }) => <CalibrationText c={row.original.calibration} /> },
  {
    accessorKey: "awaitingApproval",
    header: "To approve",
    cell: ({ row }) =>
      row.original.awaitingApproval ? <span className="num rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">{row.original.awaitingApproval}</span> : <span className="text-xs text-muted-foreground">0</span>,
  },
  { accessorKey: "followUp", header: "Suggested follow-up", enableSorting: false, cell: ({ row }) => <span className="block max-w-80 text-xs text-muted-foreground">{row.original.followUp ?? ""}</span> },
  { accessorKey: "lastActive", header: "Last active", cell: ({ row }) => <span className="num text-xs text-muted-foreground">{when(row.original.lastActive)}</span> },
];

/** Reads ?accounts=all, so it sits under Suspense (the toggle lives in the URL: refresh and Back keep it). */
export function RosterTable({ rows }: { rows: RosterRow[] }) {
  return (
    <React.Suspense fallback={<RosterTableInner rows={rows} showTest={false} />}>
      <RosterTableFromUrl rows={rows} />
    </React.Suspense>
  );
}

function RosterTableFromUrl({ rows }: { rows: RosterRow[] }) {
  const showTest = useSearchParams().get("accounts") === "all";
  return <RosterTableInner rows={rows} showTest={showTest} />;
}

function RosterTableInner({ rows, showTest }: { rows: RosterRow[]; showTest: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const setShowTest = (v: boolean) => router.replace(v ? `${pathname}?accounts=all` : pathname, { scroll: false });
  const hidden = rows.filter((r) => r.who !== "human").length;
  const data = showTest ? rows : rows.filter((r) => r.who === "human");
  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search students"
      pageSize={15}
      onRowClick={(r) => router.push(`/professor/students/${encodeURIComponent(r.pseudonym)}`)}
      empty={showTest ? "No students yet." : `No student accounts yet${hidden ? ` (${hidden} test or agent accounts hidden)` : ""}.`}
      toolbar={
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch size="sm" checked={showTest} onCheckedChange={setShowTest} />
          Show test and agent accounts <span className="num">({hidden})</span>
        </label>
      }
    />
  );
}
