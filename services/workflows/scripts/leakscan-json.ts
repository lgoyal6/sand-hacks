// Excluded from this package's typecheck (tsconfig): @unprompted/leakscan uses extensionless imports that
// nodenext rejects. tsx runs it fine; it is only ever run as a child process (see agents/leak-scout.ts).
// Runs D's leak scan out of process (the Mastra bundle can't load @unprompted/leakscan's raw TS).
// stdin: {"items":[{"id","stem"}], "threshold"?}  stdout: {"scans": ItemScan[]}  (nothing is written)
import { BrightDataSerp, brightDataFromEnv, scanAll } from "@unprompted/leakscan";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { items, threshold, windows, fuzzy } = JSON.parse(input) as { items: { id: string; stem: string }[]; threshold?: number; windows?: number; fuzzy?: boolean };
const cfg = brightDataFromEnv();
if (!cfg) {
  console.error("Bright Data isn't configured (BRIGHTDATA_API_TOKEN, BRIGHTDATA_SERP_ZONE).");
  process.exit(2);
}
const scans = await scanAll(items, new BrightDataSerp(cfg), { threshold: threshold ?? 0.5, concurrency: 2, ...(windows ? { windows } : {}), ...(fuzzy === false ? { fuzzy: false } : {}) });
process.stdout.write(JSON.stringify({ scans }));
