// Serves leak evidence screenshots captured by services/leakscan (data/leak-screens, gitignored).
// Owner: D. Will move to Neon Object Storage (private bucket "leak-evidence").
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/db/fixtures";

const DIR = path.join(DATA_DIR, "leak-screens");

export async function GET(_req: Request, ctx: RouteContext<"/professor/screens/[file]">) {
  const { file } = await ctx.params;
  if (!/^leak-[a-f0-9]{12}\.png$/.test(file)) return new Response("Not found", { status: 404 });
  try {
    const buf = await fs.readFile(path.join(DIR, file));
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
