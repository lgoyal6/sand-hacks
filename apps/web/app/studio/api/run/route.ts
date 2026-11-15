// Studio run stream (owner: B). Server-Sent Events of transform runner events.
//   GET /studio/api/run?mode=replay&recording=variants_events.q1-real-partial.jsonl
//   GET /studio/api/run?mode=live&items=sample-stats-q1&n=2&attack=0
// Live mode spawns the workflows CLI (one run at a time: the Gemini key is free tier).
import type { ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FIXTURES_DIR } from "@/lib/db/fixtures";
import { spawnWorkflow } from "@/lib/workflows";
import { mastraAvailable, streamTransform } from "../../_lib/mastra";

const g = globalThis as unknown as { __studioLiveRun?: ChildProcess | null };

function sse(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "live" ? "live" : "replay";
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (d: unknown) => {
        if (!closed) controller.enqueue(enc.encode(sse(d)));
      };
      const close = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      req.signal.addEventListener("abort", () => (closed = true));

      try {
        if (mode === "replay") await replay(url, send, () => closed);
        else if (url.searchParams.get("engine") !== "cli" && (await mastraAvailable())) await viaMastra(url, send, () => closed, req.signal);
        else await live(url, send, () => closed, req.signal);
      } catch (e) {
        send({ type: "run_finished", ok: false, message: String((e as Error).message ?? e) });
      }
      close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}

/** Replay a recorded run with its real ordering; gaps are compressed so quota waits don't stall the demo. */
async function replay(url: URL, send: (d: unknown) => void, closed: () => boolean) {
  const name = url.searchParams.get("recording") ?? "";
  if (!/^variants_events[\w.-]*\.jsonl$/.test(name)) throw new Error("unknown recording");
  const lines = (await fs.readFile(path.join(FIXTURES_DIR, name), "utf8")).split("\n").filter(Boolean);
  const maxGap = Number(url.searchParams.get("maxGapMs") ?? 1200);
  send({ type: "run_started", mode: "replay", label: `Replay of a recorded run (${name}), time compressed` });
  let prevT = 0;
  for (const line of lines) {
    if (closed()) return;
    const e = JSON.parse(line) as { t?: number };
    await sleep(Math.min(Math.max(0, (e.t ?? prevT) - prevT), maxGap));
    prevT = e.t ?? prevT;
    send(e);
  }
  send({ type: "run_finished", ok: true, message: "Replay finished. This recording stopped early (quota), so nothing in it was re-attacked." });
}

async function live(url: URL, send: (d: unknown) => void, closed: () => boolean, signal: AbortSignal) {
  if (g.__studioLiveRun && g.__studioLiveRun.exitCode === null) throw new Error("A transform run is already in progress.");
  const items = (url.searchParams.get("items") ?? "").split(",").filter((s) => /^[\w-]+$/.test(s));
  if (!items.length) throw new Error("Pick at least one question to transform.");
  const n = Math.min(5, Math.max(1, Number(url.searchParams.get("n") ?? 2)));
  const attack = url.searchParams.get("attack") === "1";
  const quiz = url.searchParams.get("quiz") ?? "sample-stats";
  if (!/^[\w-]+$/.test(quiz)) throw new Error("bad quiz id");

  const eventsFile = path.join(os.tmpdir(), `unprompted-run-${Date.now()}.jsonl`);
  await fs.writeFile(eventsFile, "");
  const args = ["--quiz", `data/quizzes/${quiz}.md`, "--items", items.join(","), "--n", String(n), "--events", eventsFile];
  if (!attack) args.push("--no-attack");
  const child = spawnWorkflow("transform", args);
  child.stdin.end(); // nothing to send (was stdio "ignore")
  g.__studioLiveRun = child;
  let tail = "";
  const keep = (d: Buffer) => (tail = (tail + d.toString()).slice(-2000));
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  signal.addEventListener("abort", () => child.kill("SIGTERM"));
  const exited = new Promise<number | null>((r) => child.on("close", r));

  send({ type: "run_started", mode: "live", label: `Live run on ${items.join(", ")} (${n} candidate${n === 1 ? "" : "s"} each${attack ? ", with re-attack" : ", no re-attack"})` });
  let offset = 0;
  let done = false;
  exited.then(() => (done = true));
  while (!closed()) {
    const buf = await fs.readFile(eventsFile, "utf8");
    const fresh = buf.slice(offset);
    const lastNl = fresh.lastIndexOf("\n");
    if (lastNl >= 0) {
      for (const line of fresh.slice(0, lastNl).split("\n").filter(Boolean)) send(JSON.parse(line));
      offset += lastNl + 1;
    }
    if (done) break;
    await sleep(300);
  }
  const code = await exited;
  g.__studioLiveRun = null;
  await fs.rm(eventsFile, { force: true });
  const summary = tail.split("\n").filter((l) => /candidates:|refusing|No solve rate|Error/.test(l)).slice(-2).join(" ");
  send({ type: "run_finished", ok: code === 0, message: summary || (code === 0 ? "Run finished." : `Run exited with code ${code}.`) });
}

/**
 * Live run through the Mastra workflow (select-targets -> transform -> professor-approval).
 * Runner events arrive as workflow-step-output chunks; a suspend means "waiting for the professor".
 */
async function viaMastra(url: URL, send: (d: unknown) => void, closed: () => boolean, signal: AbortSignal) {
  const items = (url.searchParams.get("items") ?? "").split(",").filter((s) => /^[\w-]+$/.test(s));
  if (!items.length) throw new Error("Pick at least one question to transform.");
  const n = Math.min(5, Math.max(1, Number(url.searchParams.get("n") ?? 2)));
  const quiz = url.searchParams.get("quiz") ?? "sample-stats";
  if (!/^[\w-]+$/.test(quiz)) throw new Error("bad quiz id");
  // solveRates: null lets the workflow compute a like-for-like baseline (same agent model as the retake).
  const { runId, chunks } = await streamTransform(
    { quizId: quiz, itemIds: items, solveRates: null, leakedItemIds: [], assumeSolveRate: null, candidatesPerItem: n },
    signal,
  );
  send({ type: "run_started", mode: "live", label: `Mastra workflow run ${runId.slice(0, 8)} on ${items.join(", ")} (${n} candidate${n === 1 ? "" : "s"} each)`, runId });
  let finished = false;
  for await (const c of chunks) {
    if (closed()) return;
    const p = c.payload ?? {};
    if (c.type === "workflow-step-output" && p.output && typeof p.output === "object") send(p.output);
    else if (c.type === "workflow-step-suspended" || (c.type === "workflow-step-result" && p.status === "suspended")) {
      const verified = ((p.suspendPayload as { verified?: { id: string }[] } | undefined)?.verified ?? []).map((v) => v.id);
      send({ type: "awaiting_approval", runId, verified });
    } else if (c.type === "workflow-step-result" && p.status === "failed") {
      const err = (p as { error?: { message?: string } }).error?.message ?? "step failed";
      send({ type: "error", message: `${p.stepName ?? "step"}: ${err}` });
    } else if (c.type === "workflow-finish") {
      finished = true;
      const st = p.workflowStatus as string | undefined;
      send({
        type: "run_finished",
        ok: st === "success" || st === "suspended",
        message: st === "suspended" ? "Paused for your decision. Approve or reject each verified variant." : st === "success" ? "Run finished." : `Run ${st ?? "ended"}.`,
      });
    }
  }
  if (!finished) send({ type: "run_finished", ok: false, message: "The workflow stream ended early." });
}
