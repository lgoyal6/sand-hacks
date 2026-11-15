// Excluded from this package's typecheck (tsconfig): @unprompted/leakscan uses extensionless imports that
// nodenext rejects. tsx runs it fine; it is only ever run as a child process (see agents/leak-scout.ts).
// Runs D's leak scan out of process (the Mastra bundle can't load @unprompted/leakscan's raw TS).
// stdin: {"items":[{"id","stem"}], "threshold"?}  stdout: {"scans": ItemScan[]}  (nothing is written)
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BrightDataSerp, brightDataFromEnv, scanAll } from "@unprompted/leakscan";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { items, threshold, windows, fuzzy } = JSON.parse(input) as { items: { id: string; stem: string }[]; threshold?: number; windows?: number; fuzzy?: boolean };
const cfg = brightDataFromEnv();
if (!cfg) {
  console.error("Bright Data isn't configured (BRIGHTDATA_API_TOKEN, BRIGHTDATA_SERP_ZONE).");
  process.exit(2);
}
// SERP budget: cache each question's scan for 24 h (same stem + options = same searches).
const CACHE = path.resolve(import.meta.dirname, "../.cache/leakscan");
const keyOf = (stem: string) => createHash("sha256").update(JSON.stringify({ stem, threshold, windows, fuzzy })).digest("hex").slice(0, 24);
const cached = new Map<string, unknown>();
const todo: typeof items = [];
for (const it of items) {
  try {
    const c = JSON.parse(await readFile(path.join(CACHE, `${keyOf(it.stem)}.json`), "utf8")) as { at: string; scan: { itemId: string } };
    if (Date.now() - Date.parse(c.at) < 24 * 3600_000) {
      cached.set(it.id, { ...c.scan, itemId: it.id, findings: (c.scan as { findings: { itemId: string }[] }).findings.map((f) => ({ ...f, itemId: it.id })), cached: true });
      continue;
    }
  } catch {
    /* not cached */
  }
  todo.push(it);
}
const fresh = todo.length ? await scanAll(todo, new BrightDataSerp(cfg), { threshold: threshold ?? 0.5, concurrency: 2, ...(windows ? { windows } : {}), ...(fuzzy === false ? { fuzzy: false } : {}) }) : [];
await mkdir(CACHE, { recursive: true });
for (const sc of fresh) {
  const it = todo.find((t) => t.id === sc.itemId)!;
  if (!sc.queries.every((q) => q.error)) await writeFile(path.join(CACHE, `${keyOf(it.stem)}.json`), JSON.stringify({ at: new Date().toISOString(), scan: sc }));
}
const scans = items.map((it) => cached.get(it.id) ?? fresh.find((sc) => sc.itemId === it.id));
process.stdout.write(JSON.stringify({ scans, searched: todo.length, fromCache: cached.size }));
