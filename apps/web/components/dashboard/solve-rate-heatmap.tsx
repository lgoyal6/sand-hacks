import type { AgentRun } from "@unprompted/shared";

export interface HeatItem {
  id: string;
  label: string;
  stem: string;
}

/** A light brand tint: 0% is near-white, 100% a soft blue. Dark text always; the number is the main cue. */
function cellStyle(rate: number) {
  const pct = Math.round(8 + rate * 34);
  return { background: `color-mix(in oklch, var(--brand) ${pct}%, white)` };
}

/** Rows: questions. Columns: agent · model. Cell: correct / runs. */
export function SolveRateHeatmap({ items, runs }: { items: HeatItem[]; runs: AgentRun[] }) {
  const cols = [...new Set(runs.map((r) => `${r.agent} · ${r.model.replace(/^[a-z]+:/, "")}`))].sort();
  const key = (r: AgentRun) => `${r.agent} · ${r.model.replace(/^[a-z]+:/, "")}`;
  const cell = new Map<string, { runs: number; correct: number; seconds: number }>();
  for (const r of runs) {
    const k = `${r.itemId}|${key(r)}`;
    const c = cell.get(k) ?? { runs: 0, correct: 0, seconds: 0 };
    c.runs++;
    c.correct += r.correct ? 1 : 0;
    c.seconds += r.seconds;
    cell.set(k, c);
  }
  const allCols = [...cols, "All agents"];

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th className="w-[45%] text-left text-xs font-medium text-muted-foreground">Question</th>
            {allCols.map((c) => (
              <th key={c} className="px-1 text-center text-xs font-medium text-muted-foreground">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const totals = cols.reduce(
              (acc, c) => {
                const v = cell.get(`${it.id}|${c}`);
                return v ? { runs: acc.runs + v.runs, correct: acc.correct + v.correct } : acc;
              },
              { runs: 0, correct: 0 },
            );
            return (
              <tr key={it.id}>
                <td className="py-1 pr-2 align-middle">
                  <span className="num mr-2 text-xs text-muted-foreground">{it.label}</span>
                  <span className="line-clamp-1 inline text-sm" title={it.stem}>
                    {it.stem}
                  </span>
                </td>
                {allCols.map((c) => {
                  const v = c === "All agents" ? totals : cell.get(`${it.id}|${c}`);
                  if (!v || !v.runs)
                    return (
                      <td key={c} className="rounded-md bg-muted text-center text-xs text-muted-foreground">
                        not run
                      </td>
                    );
                  const rate = v.correct / v.runs;
                  return (
                    <td
                      key={c}
                      className="h-11 min-w-24 rounded-lg text-center text-foreground"
                      style={cellStyle(rate)}
                      title={`${v.correct} of ${v.runs} runs correct`}
                    >
                      <span className="num block text-sm font-semibold">{Math.round(rate * 100)}%</span>
                      <span className="num block text-[10px] opacity-80">
                        {v.correct}/{v.runs}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        A question is agent-solvable at 60% or more. Cells show correct runs over total runs, so small samples stay visible.
      </p>
    </div>
  );
}
