"use client";
import * as React from "react";
import { AgentState, type AgentStatus } from "@/components/ui/agent-state";
import { VoiceOrb, type VoiceOrbState } from "@/components/ui/siri-orb";
import { OrbAvatar } from "@/components/ui/orb-avatar";
import { DataTable, inFacet, type DataColumn } from "@/components/ui/data-table";
import { SampleBadge } from "@/components/ui/sample-badge";
import { Button } from "@/components/ui/button";

const STATUSES: AgentStatus[] = ["idle", "thinking", "working", "needs-input", "complete", "error"];
const ORB_STATES: VoiceOrbState[] = ["idle", "listening", "thinking", "speaking"];

type Row = { student: string; item: string; correct: boolean; understanding: number | null; quadrant: string };
const ROWS: Row[] = [
  { student: "s-01", item: "Q1", correct: true, understanding: 4, quadrant: "correct_explained" },
  { student: "s-02", item: "Q1", correct: true, understanding: 1, quadrant: "explain_gap" },
  { student: "s-03", item: "Q2", correct: false, understanding: 3, quadrant: "near_miss" },
  { student: "s-04", item: "Q4", correct: false, understanding: 0, quadrant: "wrong_unexplained" },
];
const QUADRANT_CLASS: Record<string, string> = {
  correct_explained: "bg-understood-soft text-understood",
  explain_gap: "bg-gap-soft text-gap",
  near_miss: "bg-near-miss-soft text-near-miss",
  wrong_unexplained: "bg-unexplained-soft text-unexplained",
};
const columns: DataColumn<Row>[] = [
  { accessorKey: "student", header: "Student" },
  { accessorKey: "item", header: "Question" },
  { accessorKey: "correct", header: "Correct", cell: ({ getValue }) => (getValue() ? "Yes" : "No") },
  { accessorKey: "understanding", header: "Explanation (0-4)", cell: ({ getValue }) => <span className="num">{getValue() ?? "-"}</span> },
  {
    accessorKey: "quadrant",
    header: "Quadrant",
    filterFn: inFacet,
    cell: ({ getValue }) => (
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${QUADRANT_CLASS[getValue() as string]}`}>
        {(getValue() as string).replace("_", " ")}
      </span>
    ),
  },
];

const SWATCHES = ["understood", "gap", "near-miss", "unexplained", "leak", "agent", "verified", "rejected"];

export function DesignGallery() {
  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Voice orb (C: probe)</h2>
        <div className="flex flex-wrap items-end gap-10">
          {ORB_STATES.map((s) => (
            <VoiceOrb key={s} state={s} size="120px" showLabel />
          ))}
          <div className="flex items-center gap-2">
            <OrbAvatar size="sm" /> <OrbAvatar size="md" /> <OrbAvatar size="lg" />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Agent state (B: studio, A: replay)</h2>
        <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
          {STATUSES.map((s) => (
            <AgentState key={s} status={s} description={`status="${s}"`} />
          ))}
          <AgentState status="complete" tone="muted" label="Rejected" description="Agent still solves it 3 of 3" />
          <AgentState status="working" size="sm" label="browser-use · gemini" />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Data table</h2>
          <SampleBadge />
        </div>
        <DataTable
          columns={columns}
          data={ROWS}
          searchPlaceholder="Search students"
          facet={{ columnId: "quadrant", label: "Quadrant", format: (v) => v.replace("_", " ") }}
          selectable
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Semantic colors and buttons</h2>
        <div className="flex flex-wrap gap-2">
          {SWATCHES.map((s) => (
            <span key={s} className="rounded-md border border-border px-3 py-1.5 text-xs" style={{ background: `var(--${s}-soft, var(--muted))`, color: `var(--${s})` }}>
              {s}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Button>Primary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
        </div>
      </section>
    </div>
  );
}
