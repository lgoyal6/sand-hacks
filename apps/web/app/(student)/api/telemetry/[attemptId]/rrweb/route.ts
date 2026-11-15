import { NextResponse } from "next/server";
import { writeRecording } from "@/lib/telemetry/server";

export async function POST(req: Request, ctx: RouteContext<"/api/telemetry/[attemptId]/rrweb">) {
  const { attemptId } = await ctx.params;
  if (!/^[\w-]{1,64}$/.test(attemptId)) return NextResponse.json({ error: "bad attempt id" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { events?: unknown[] } | null;
  if (!body || !Array.isArray(body.events)) return NextResponse.json({ error: "expected { events: [] }" }, { status: 400 });
  await writeRecording(attemptId, body.events.slice(0, 2000));
  return NextResponse.json({ accepted: Math.min(body.events.length, 2000) });
}
