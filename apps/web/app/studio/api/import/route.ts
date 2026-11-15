// Import a pasted Markdown quiz (owner: B).
//   POST /studio/api/import  { "markdown": "# Title\n1. [mcq] ..." }
// Saves data/quizzes/<slug>.md (never overwrites), then runs the workflows ingest CLI,
// which validates it and writes it to Neon main (or fixtures). A parse error removes the file.
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/db/fixtures";
import { spawnWorkflow } from "@/lib/workflows";
import { autoScan } from "../../_lib/autoscan";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "quiz";
}

export async function POST(req: Request) {
  const { markdown } = (await req.json().catch(() => ({}))) as { markdown?: string };
  if (!markdown || markdown.length < 20) return Response.json({ error: "Paste a quiz in Markdown first." }, { status: 400 });
  if (markdown.length > 100_000) return Response.json({ error: "That quiz is too long (100 KB max)." }, { status: 413 });
  const title = markdown.match(/^#\s+(.+)$/m)?.[1] ?? "quiz";
  const dir = path.join(DATA_DIR, "quizzes");
  let slug = slugify(title);
  for (let i = 2; await fs.stat(path.join(dir, `${slug}.md`)).then(() => true, () => false); i++) slug = `${slugify(title)}-${i}`;
  const file = path.join(dir, `${slug}.md`);
  await fs.writeFile(file, markdown.endsWith("\n") ? markdown : markdown + "\n", { flag: "wx" });

  const { code, out } = await new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawnWorkflow("ingest", [`data/quizzes/${slug}.md`]);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
  if (code !== 0) {
    await fs.rm(file, { force: true });
    // tsx prints a code frame too; the parser's message is the line that starts with "Error:".
    const reason = out.split("\n").map((l) => l.trim()).find((l) => /^Error: /.test(l))?.slice(7) ?? "unrecognized format";
    return Response.json({ error: `Couldn't read that quiz: ${reason}` }, { status: 422 });
  }
  autoScan(slug, "markdown import");
  return Response.json({ quizId: slug, message: out.trim().split("\n").filter((l) => l.startsWith("Imported")).at(-1) });
}
