// Open dataset downloads (owner: D): /study/data/leaked-homework-2026-11.csv|.json and LICENSE.md.
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/db/fixtures";

const FILES: Record<string, string> = {
  "leaked-homework-2026-11.csv": "text/csv; charset=utf-8",
  "leaked-homework-2026-11.json": "application/json; charset=utf-8",
  "LICENSE.md": "text/markdown; charset=utf-8",
  "leak-index-2026-11.csv": "text/csv; charset=utf-8",
  "leak-index-2026-11.json": "application/json; charset=utf-8",
};

export async function GET(_req: Request, ctx: RouteContext<"/study/data/[file]">) {
  const { file } = await ctx.params;
  const type = FILES[file];
  if (!type) return new Response("Not found", { status: 404 });
  const body = await fs.readFile(path.join(DATA_DIR, "open", file));
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${file}"`, "Cache-Control": "public, max-age=3600" },
  });
}
