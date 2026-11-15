// Client for B's Mastra server (services/workflows, `pnpm --filter @unprompted/workflows mastra:dev`, :3102).
// Server only. The transform runs as a Mastra workflow that suspends for the professor's decision.
import "server-only";

export const MASTRA_URL = (process.env.MASTRA_URL?.trim() || "http://localhost:3102").replace(/\/$/, "");

export async function mastraAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${MASTRA_URL}/api/workflows`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    if (!r.ok) return false;
    const body = (await r.json()) as Record<string, unknown>;
    return "transform" in body;
  } catch {
    return false;
  }
}

export interface MastraChunk {
  type: string;
  runId?: string;
  payload?: Record<string, unknown> & { output?: unknown; workflowStatus?: string; stepName?: string; id?: string; status?: string; suspendPayload?: unknown };
}

/** Records are JSON objects separated by the ASCII record separator (\x1e). */
async function* records(body: ReadableStream<Uint8Array>): AsyncGenerator<MastraChunk> {
  const dec = new TextDecoder();
  let buf = "";
  for await (const part of body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(part, { stream: true });
    let i;
    while ((i = buf.indexOf("\x1e")) >= 0) {
      const rec = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (rec) yield JSON.parse(rec) as MastraChunk;
    }
  }
  if (buf.trim()) yield JSON.parse(buf.trim()) as MastraChunk;
}

export async function streamTransform(input: Record<string, unknown>, signal?: AbortSignal): Promise<{ runId: string; chunks: AsyncGenerator<MastraChunk> }> {
  const runId = crypto.randomUUID();
  const c = await fetch(`${MASTRA_URL}/api/workflows/transform/create-run?runId=${runId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal,
  });
  if (!c.ok) throw new Error(`Mastra create-run failed: ${c.status}`);
  const r = await fetch(`${MASTRA_URL}/api/workflows/transform/stream?runId=${runId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inputData: input }),
    signal,
  });
  if (!r.ok || !r.body) throw new Error(`Mastra stream failed: ${r.status}`);
  return { runId, chunks: records(r.body) };
}

/** Resume a suspended transform run with the professor's decisions. */
export async function resumeTransform(runId: string, decisions: { id: string; approve: boolean; note?: string }[]) {
  const r = await fetch(`${MASTRA_URL}/api/workflows/transform/resume-async?runId=${encodeURIComponent(runId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step: "professor-approval", resumeData: { decisions } }),
  });
  const body = (await r.json().catch(() => ({}))) as { status?: string; result?: { decided?: string[] }; error?: unknown; message?: string };
  if (!r.ok) throw new Error(`Mastra resume failed: ${r.status} ${body.message ?? JSON.stringify(body.error ?? "").slice(0, 200)}`);
  return body;
}
