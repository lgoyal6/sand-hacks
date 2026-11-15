import { NextResponse } from "next/server";
import { sanitize, writeEvents } from "@/lib/telemetry/server";

export async function POST(req: Request, ctx: RouteContext<"/api/telemetry/[attemptId]">) {
  const { attemptId } = await ctx.params;
  if (!/^[\w-]{1,64}$/.test(attemptId)) return NextResponse.json({ error: "bad attempt id" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { events?: unknown[] } | null;
  if (!body || !Array.isArray(body.events)) return NextResponse.json({ error: "expected { events: [] }" }, { status: 400 });
  const events = sanitize(body.events, attemptId);
  const sink = await writeEvents(events);
  return NextResponse.json({ accepted: events.length, sink });
}
