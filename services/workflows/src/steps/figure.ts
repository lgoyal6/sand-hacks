// Figure-only variants: the numbers a question needs live only in a rendered PNG table.
// Students and agents see the image; the answer checker and judge panel get the same data as text
// (figureText), so the key check and "same skill" check stay rigorous.
// Accessibility: figure-only items need an accommodation path (data as text on request + a probe).
import { spawn } from "node:child_process";
import { envVal } from "./llm.js";

export interface FigureTable {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

const PY = `
import sys, json, io, base64
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
t = json.load(sys.stdin)
cols, rows = t["columns"], [[str(c) for c in r] for r in t["rows"]]
h = 0.42 * (len(rows) + 1) + 0.5
widest = max(len(str(x)) for row in [cols] + rows for x in row)
fig, ax = plt.subplots(figsize=(max(3.2, 0.11 * widest * len(cols) + 1.0), h), dpi=110)
ax.axis("off")
ax.set_title(t.get("title", ""), fontsize=11, loc="left")
tbl = ax.table(cellText=rows, colLabels=cols, loc="center", cellLoc="center")
tbl.auto_set_font_size(False); tbl.set_fontsize(10); tbl.scale(1, 1.35)
tbl.auto_set_column_width(col=list(range(len(cols))))
for (r, c), cell in tbl.get_celld().items():
    cell.set_edgecolor("#c8ccd2")
    if r == 0: cell.set_facecolor("#f1f3f5"); cell.set_text_props(weight="bold")
buf = io.BytesIO(); fig.savefig(buf, format="png", bbox_inches="tight", facecolor="white"); plt.close(fig)
sys.stdout.write(base64.b64encode(buf.getvalue()).decode())
`;

/** Render a small table to a PNG data URL with matplotlib (python3 on PATH, or FIGURE_PYTHON). */
export function renderTablePng(t: FigureTable): Promise<string> {
  return new Promise((resolve, reject) => {
    const py = spawn(envVal("FIGURE_PYTHON") ?? "python3", ["-c", PY], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    py.stdout.on("data", (d) => (out += d));
    py.stderr.on("data", (d) => (err += d));
    py.on("error", reject);
    py.on("close", (code) => (code === 0 && out ? resolve(`data:image/png;base64,${out}`) : reject(new Error(`figure render failed: ${err.slice(-300)}`))));
    py.stdin.end(JSON.stringify(t));
  });
}

/** Text version of the table for the checkers (never sent to students or agents). */
export function tableText(t: FigureTable): string {
  return [t.title, t.columns.join(" | "), ...t.rows.map((r) => r.join(" | "))].join("\n");
}

/** Numbers in the table that also appear in the stem: if any do, the figure isn't the only source. */
export function leakedNumbers(stem: string, t: FigureTable): string[] {
  const inStem = new Set(stem.match(/-?\d+(?:\.\d+)?/g) ?? []);
  const cells = t.rows.flat().flatMap((c) => String(c).match(/-?\d+(?:\.\d+)?/g) ?? []);
  return [...new Set(cells.filter((n) => inStem.has(n) && !/^[0-9]$/.test(n)))];
}

/** Parse tableText() output back into a table (re-rendering stored figures). */
export function parseTableText(text: string): FigureTable {
  const [title = "", head = "", ...rows] = text.split("\n");
  return { title, columns: head.split(" | "), rows: rows.map((r) => r.split(" | ")) };
}
