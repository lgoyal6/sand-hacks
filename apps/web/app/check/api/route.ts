// POST /check/api {question} -> text/event-stream of CheckEvent (owner: D). Public; guardrails in _lib/check.ts.
import { cached, hashQuestion, normalizeQuestion, rateLimit, remember, runCheck, type CheckEvent } from "../_lib/check";

export async function POST(req: Request) {
  let question = "";
  try {
    const body = (await req.json()) as { question?: unknown };
    question = normalizeQuestion(typeof body.question === "string" ? body.question : "");
  } catch {
    return Response.json({ error: "Send JSON: { question }" }, { status: 400 });
  }
  if (question.length < 20 || question.length > 600) {
    return Response.json({ error: "Paste one question, between 20 and 600 characters." }, { status: 400 });
  }
  const hash = hashQuestion(question);
  const hit = cached(hash);

  if (!hit) {
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
    const rl = rateLimit(ip);
    if (!rl.ok) {
      return Response.json(
        { error: `That's 5 checks in 10 minutes. Try again in ${Math.ceil(rl.retryInSec / 60)} min.` },
        { status: 429, headers: { "Retry-After": String(rl.retryInSec) } },
      );
    }
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: CheckEvent) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        if (hit) {
          // Replay a cached result with a short beat between events so the UI still reads as a scan.
          for (const e of hit) {
            emit(e.type === "start" ? { ...e, cached: true } : e);
            await new Promise((r) => setTimeout(r, e.type === "query" ? 350 : 120));
          }
        } else {
          remember(hash, await runCheck(question, emit));
        }
      } catch {
        emit({ type: "error", message: "The check failed. Please try again." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" },
  });
}
