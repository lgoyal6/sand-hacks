// End-to-end transform through the real Mastra workflow, with run state in Neon (schema "mastra").
// Runs in its own process, so dev-server hot reloads can't interrupt it.
//   tsx --env-file=../../.env.local scripts/e2e-transform.ts start <itemId> [n] [events.jsonl]
//   tsx --env-file=../../.env.local scripts/e2e-transform.ts resume <runId> <variantId> approve|reject
import { appendFile, writeFile } from "node:fs/promises";
import { mastra } from "../src/mastra/index.js";

const [mode, a, b, c] = process.argv.slice(2);
const wf = mastra.getWorkflow("transform");
const t0 = Date.now();
if (mode === "start") {
  const itemId = a!;
  const events = c;
  if (events) await writeFile(events, "");
  const run = await wf.createRun();
  console.log(`runId=${run.runId}`);
  const stream = run.stream({ inputData: { quizId: itemId.replace(/-q\d+$/, ""), itemIds: [itemId], solveRates: null, leakedItemIds: [], assumeSolveRate: null, candidatesPerItem: Number(b ?? 2), attackModel: "gmi:google/gemini-3.8-flash" } });
  for await (const chunk of stream.fullStream) {
    const ch = chunk as { type: string; payload?: { output?: Record<string, unknown> } };
    const e = ch.type === "workflow-step-output" ? ch.payload?.output : undefined;
    if (!e) continue;
    if (events) await appendFile(events, JSON.stringify({ t: Date.now() - t0, ...e }) + "\n");
    if (e.type !== "stage") console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s ${e.type} ${JSON.stringify(e).slice(0, 220)}`);
  }
  const res = await stream.result;
  console.log(`status=${res.status}`);
  if (res.status === "suspended") console.log("waiting:", JSON.stringify((res as any).steps["professor-approval"].suspendPayload.verified.map((v: any) => v.id)));
  if (res.status === "success") console.log("result:", JSON.stringify((res as any).result.experiments.map((e: any) => [e.id, e.status, e.reasons.at(-1)])));
} else {
  const run = await wf.createRun({ runId: a! });
  const res = await run.resume({ step: "professor-approval", resumeData: { decisions: [{ id: b!, approve: c === "approve" }] } });
  console.log(`status=${res.status}`, JSON.stringify((res as any).result?.experiments?.map((e: any) => [e.id, e.status]) ?? (res as any).error));
}
process.exit(0);
