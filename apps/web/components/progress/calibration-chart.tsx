"use client";
// Calibration dot plot: per topic, confidence before explaining, after explaining, and how it went,
// all on one 0-100% axis (one axis, no dual scales). Identity never relies on color alone: each series
// has its own shape (hollow circle / filled circle / diamond), a legend, and a table view.
// Colors validated with the dataviz validator (light on #ffffff, dark on #020817).
import { useState } from "react";

export interface CalibrationRow {
  id: string;
  label: string;
  before: number | null; // 0..1
  after: number | null;
  outcome: number | null;
  note?: string; // e.g. "4 think-alouds"
}

const SERIES = [
  { key: "before", name: "Sure before explaining", shape: "ring" },
  { key: "after", name: "Sure after explaining", shape: "dot" },
  { key: "outcome", name: "How it went", shape: "diamond" },
] as const;

const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);

function Mark({ shape, x, y }: { shape: (typeof SERIES)[number]["shape"]; x: number; y: number }) {
  if (shape === "ring") return <circle cx={x} cy={y} r={5.5} fill="var(--viz-surface)" stroke="var(--viz-before)" strokeWidth={2.5} />;
  if (shape === "dot") return <circle cx={x} cy={y} r={6} fill="var(--viz-after)" stroke="var(--viz-surface)" strokeWidth={2} />;
  return <rect x={x - 5.5} y={y - 5.5} width={11} height={11} transform={`rotate(45 ${x} ${y})`} fill="var(--viz-outcome)" stroke="var(--viz-surface)" strokeWidth={2} />;
}

export function CalibrationChart({ rows, outcomeLabel = "How it went" }: { rows: CalibrationRow[]; outcomeLabel?: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const W = 640;
  const left = 200;
  const right = 24;
  const rowH = 44;
  const top = 8;
  const H = top + rows.length * rowH + 28;
  const x = (v: number) => left + v * (W - left - right);
  const names = { before: SERIES[0].name, after: SERIES[1].name, outcome: outcomeLabel };

  return (
    <div className="viz-root space-y-3">
      <style>{`
        .viz-root { --viz-surface:#ffffff; --viz-before:#994eb7; --viz-after:#2563eb; --viz-outcome:#009589; --viz-grid:color-mix(in oklab, currentColor 12%, transparent); }
        @media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) .viz-root { --viz-surface:#020817; --viz-before:#b06ace; --viz-after:#427ff7; --viz-outcome:#12a195; } }
        :root[data-theme="dark"] .viz-root, .dark .viz-root { --viz-surface:#020817; --viz-before:#b06ace; --viz-after:#427ff7; --viz-outcome:#12a195; }
      `}</style>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground" aria-hidden={table}>
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <Mark shape={s.shape} x={7} y={7} />
            </svg>
            {names[s.key]}
          </span>
        ))}
        <button type="button" className="ml-auto text-xs underline-offset-2 hover:underline" onClick={() => setTable((t) => !t)}>
          {table ? "Show chart" : "Show as table"}
        </button>
      </div>

      {table ? (
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Topic</th>
              <th className="py-1 font-medium">{names.before}</th>
              <th className="py-1 font-medium">{names.after}</th>
              <th className="py-1 font-medium">{names.outcome}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-1.5">{r.label}</td>
                <td>{pct(r.before)}</td>
                <td>{pct(r.after)}</td>
                <td>{pct(r.outcome)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Confidence before and after explaining, and how it went, per topic">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={top} y2={H - 24} stroke="var(--viz-grid)" />
                <text x={x(t)} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {t * 100}%
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              const y = top + i * rowH + rowH / 2;
              const vals = [r.before, r.after, r.outcome].filter((v): v is number => v !== null);
              return (
                <g key={r.id} onMouseEnter={() => setHover(r.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(r.id)} onBlur={() => setHover(null)} tabIndex={0}>
                  {/* oversized hit target */}
                  <rect x={0} y={y - rowH / 2} width={W} height={rowH} fill={hover === r.id ? "var(--viz-grid)" : "transparent"} rx={6} />
                  <text x={left - 12} y={y + 4} textAnchor="end" className="fill-foreground text-[13px]">
                    {r.label.length > 26 ? `${r.label.slice(0, 25)}…` : r.label}
                  </text>
                  {vals.length > 1 && <line x1={x(Math.min(...vals))} x2={x(Math.max(...vals))} y1={y} y2={y} stroke="var(--viz-grid)" strokeWidth={2} />}
                  {r.before !== null && <Mark shape="ring" x={x(r.before)} y={y} />}
                  {r.after !== null && <Mark shape="dot" x={x(r.after)} y={y} />}
                  {r.outcome !== null && <Mark shape="diamond" x={x(r.outcome)} y={y} />}
                </g>
              );
            })}
          </svg>
          {hover &&
            (() => {
              const i = rows.findIndex((r) => r.id === hover);
              const r = rows[i];
              return (
                <div
                  className="pointer-events-none absolute right-2 rounded-lg border bg-popover px-3 py-2 text-xs shadow-sm"
                  style={{ top: `${((top + i * rowH) / H) * 100}%` }}
                  role="status"
                >
                  <p className="font-medium text-foreground">{r.label}</p>
                  <p className="text-muted-foreground">
                    {names.before}: <span className="text-foreground tabular-nums">{pct(r.before)}</span>
                  </p>
                  <p className="text-muted-foreground">
                    {names.after}: <span className="text-foreground tabular-nums">{pct(r.after)}</span>
                  </p>
                  <p className="text-muted-foreground">
                    {names.outcome}: <span className="text-foreground tabular-nums">{pct(r.outcome)}</span>
                  </p>
                  {r.note && <p className="mt-1 text-muted-foreground">{r.note}</p>}
                </div>
              );
            })()}
        </div>
      )}
    </div>
  );
}
