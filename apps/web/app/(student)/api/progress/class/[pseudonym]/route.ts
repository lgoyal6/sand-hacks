import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/server";
import { loadClassProgress } from "../../../../_lib/class";

// Professor-only detail for one student (by pseudonym).
export async function GET(_req: Request, ctx: RouteContext<"/api/progress/class/[pseudonym]">) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== "professor") return NextResponse.json({ error: "professors only" }, { status: 403 });
  const { pseudonym } = await ctx.params;
  if (!/^[\w-]{1,64}$/.test(pseudonym)) return NextResponse.json({ error: "bad pseudonym" }, { status: 400 });
  const [student] = await loadClassProgress({ pseudonym });
  return student ? NextResponse.json({ student }) : NextResponse.json({ error: "not found" }, { status: 404 });
}
