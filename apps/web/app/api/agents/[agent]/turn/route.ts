// One agent turn (owner: B). Proxies to the Mastra agents on :3102 and streams NDJSON:
//   AgentEvent lines (packages/shared) for status and tool calls -> D's AgentPanel
//   { type: "delta", agent, text }       streamed reply text
//   { type: "message", agent, text, servedBy }   final reply, with the model that served it
//   { type: "error", agent, message }
// POST /api/agents/tutor/turn  { attemptId, input, history?: {role:"user"|"assistant", content}[] }
// Mode and quiz come from the attempt on the server (lib/agents/session), never from the request.
import type { AgentEvent } from "@unprompted/shared";
import { sessionFor } from "@/lib/agents/session";

const MASTRA_URL = (process.env.MASTRA_URL?.trim() || "http://localhost:3102").replace(/\/$/, "");

/** Agents the browser may talk to directly. Others (judge panel, rewriter) run inside workflows. */
const AGENTS: Record<string, { id: string; name: string; practiceOnly?: boolean; maxSteps?: number }> = {
  tutor: { id: "tutor", name: "Tutor" },
  // Web research can't be a way to look up answers mid-quiz: refused in graded mode, before any model call.
  researcher: { id: "researcher", name: "Researcher", practiceOnly: true, maxSteps: 6 },
};

const TOOL_LABEL: Record<string, string> = {
  startQuiz: "Loading the quiz",
  checkAnswer: "Checking the answer",
  explainResult: "Looking up what the question tests",
  brightdata_search_engine: "Searching the web (Bright Data)",
  brightdata_scrape_as_markdown: "Reading a source (Bright Data)",
};

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;
const normUrl = (u: string) => u.replace(/[.,;:]+$/, "").replace(/\/$/, "").replace(/^http:/, "https:").replace("://www.", "://");

export async function POST(req: Request, ctx: { params: Promise<{ agent: string }> }) {
  const { agent } = await ctx.params;
  const spec = AGENTS[agent];
  if (!spec) return Response.json({ error: `unknown agent: ${agent}` }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { attemptId?: string; input?: string; history?: { role: string; content: string }[] };
  const input = body.input?.trim();
  if (!input) return Response.json({ error: "input is required" }, { status: 400 });
  if (input.length > 4000) return Response.json({ error: "input is too long" }, { status: 413 });

  const session = await sessionFor(body.attemptId);
  if (spec.practiceOnly && session.mode !== "practice") {
    const now = new Date().toISOString();
    const text = "Research is available in practice mode and after your quiz. Ask me again then.";
    return new Response(
      [
        { agentId: spec.id, status: "done", label: "Not available during a graded quiz", ts: now },
        { type: "message", agent: spec.id, text, servedBy: "policy" },
      ]
        .map((o) => JSON.stringify(o))
        .join("\n") + "\n",
      { headers: { "Content-Type": "application/x-ndjson" } },
    );
  }
  const history = (body.history ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  let upstream: Response;
  try {
    upstream = await fetch(`${MASTRA_URL}/api/agents/${spec.id}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [...history, { role: "user", content: input }],
        requestContext: { mode: session.mode, quizId: session.quizId, attemptId: body.attemptId },
        maxSteps: spec.maxSteps ?? 6,
      }),
      signal: req.signal,
    });
  } catch {
    return Response.json({ error: "The agents server isn't running (Mastra on :3102)." }, { status: 503 });
  }
  if (!upstream.ok || !upstream.body) return Response.json({ error: `agent server error ${upstream.status}` }, { status: 502 });

  const enc = new TextEncoder();
  const ev = (status: AgentEvent["status"], label: string, toolCall?: AgentEvent["toolCall"]): AgentEvent => ({
    agentId: spec.id,
    status,
    label,
    ...(toolCall ? { toolCall } : {}),
    ts: new Date().toISOString(),
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      send(ev("thinking", session.mode === "graded" ? "Reading your message (graded quiz)" : "Reading your message"));
      let text = "";
      let servedBy: string | undefined;
      const seenUrls = new Set<string>(); // every URL that appeared in a tool result (search or page)
      const calls = new Map<string, { name: string; args: unknown }>();
      const dec = new TextDecoder();
      let buf = "";
      try {
        for await (const part of upstream.body as unknown as AsyncIterable<Uint8Array>) {
          buf += dec.decode(part, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            const c = JSON.parse(data) as { type: string; payload?: Record<string, unknown> };
            const p = c.payload ?? {};
            if (c.type === "step-start" && typeof p.modelId === "string") servedBy = p.modelId;
            else if (c.type === "tool-call") {
              const name = String(p.toolName);
              calls.set(String(p.toolCallId), { name, args: p.args });
              send(ev("running", TOOL_LABEL[name] ?? `Using ${name}`, { name, args: p.args as Record<string, unknown> }));
            } else if (c.type === "tool-result") {
              const call = calls.get(String(p.toolCallId));
              const name = call?.name ?? String(p.toolName);
              for (const u of JSON.stringify(p.result ?? "").match(URL_RE) ?? []) seenUrls.add(normUrl(u));
              send(ev("running", `${TOOL_LABEL[name] ?? name}: done`, { name, args: call?.args as Record<string, unknown>, result: p.result }));
            } else if (c.type === "text-delta" && typeof p.text === "string") {
              text += p.text;
              send({ type: "delta", agent: spec.id, text: p.text });
            } else if (c.type === "error") {
              send({ type: "error", agent: spec.id, message: "The agent hit a problem. Try again." });
            }
          }
        }
        if (servedBy) console.log(`[agents] ${spec.id} turn served by ${servedBy} (mode ${session.mode}, session from ${session.source})`);
        // Citation check: a cited URL must have appeared in this turn's tool results.
        const cited = [...new Set((text.match(URL_RE) ?? []).map(normUrl))];
        const sources = cited.map((url) => ({ url, verified: seenUrls.has(url) || [...seenUrls].some((s) => s.startsWith(url) || url.startsWith(s)) }));
        if (sources.some((s) => !s.verified)) console.warn(`[agents] ${spec.id} cited unverified URLs:`, sources.filter((s) => !s.verified).map((s) => s.url));
        send({ type: "message", agent: spec.id, text, servedBy, ...(sources.length ? { sources } : {}) });
        send(ev("done", text ? "Replied" : "No reply"));
      } catch (e) {
        send({ type: "error", agent: spec.id, message: (e as Error).name === "AbortError" ? "Cancelled." : "Lost the connection to the agent." });
        send(ev("error", "Lost the connection"));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache, no-transform" } });
}
