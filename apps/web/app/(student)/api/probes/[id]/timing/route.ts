import { NextResponse } from "next/server";
import { getProbe, writeTiming, type ProbePhase } from "../../../../_lib/probes";

export async function POST(req: Request, ctx: RouteContext<"/api/probes/[id]/timing">) {
  const { id } = await ctx.params;
  if (!(await getProbe(id))) return NextResponse.json({ error: "probe not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { phases?: { phase: ProbePhase; ms: number; ts?: string }[] };
  const sink = await writeTiming(id, Array.isArray(body.phases) ? body.phases.slice(0, 50) : []);
  return NextResponse.json({ sink });
}
