// POST /studio/api/leakscan {quizId}  (owner: B) -> {radar, online, total, searched, fromCache, queries, queryErrors}
// Scans every question of a quiz on the open web (Bright Data SERP via D's leakscan): exact-phrase windows only,
// at most 2 searches per question, each question cached 24 h. Findings are saved to Neon leak_finding.
// Used right after a Canvas import, so a professor's first screen answers "which of these are already online?".
import type { LeakFinding, Quiz } from "@unprompted/shared";
import { getViewer } from "@/lib/auth/server";
import { buildLeakRadar, onlineCount, type LeakRadarData } from "@/components/dashboard/leak-radar-data";
import { runWorkflows } from "../../_lib/qti";
import { replayJson, ReplayUnavailable, withReplay } from "../../_lib/replay";

export interface LeakScanResult {
  radar: LeakRadarData;
  online: number;
  total: number;
  searched: number;
  fromCache: number;
  queries: number;
  queryErrors: number;
}

type CliOut = { quizId: string; title: string; items: Quiz["items"]; findings: LeakFinding[]; searched: number; fromCache: number; queries: number; queryErrors: number };

export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer || viewer.role !== "professor") return Response.json({ error: "Professors only." }, { status: 403 });
  const { quizId } = (await req.json().catch(() => ({}))) as { quizId?: string };
  if (!quizId || !/^[\w-]+$/.test(quizId)) return Response.json({ error: "Which quiz?" }, { status: 400 });
  try {
    const r = await withReplay<LeakScanResult>(
      req,
      "leakscan",
      quizId,
      async () => {
        const out = await runWorkflows("leakscan", [quizId, "--save"]);
        const j = out.json as CliOut | null;
        if (out.code !== 0 || !j) throw new Error(out.out.split("\n").map((l) => l.trim()).find((l) => /^Error: /.test(l))?.slice(7) ?? "the leak scan failed");
        if (j.queries > 0 && j.queryErrors === j.queries) throw new Error("every web search failed (Bright Data unavailable)");
        const radar = buildLeakRadar({ id: j.quizId, title: j.title, items: j.items }, j.findings, { archiveWatch: { status: "off" } });
        return { radar, online: onlineCount(radar), total: j.items.length, searched: j.searched, fromCache: j.fromCache, queries: j.queries, queryErrors: j.queryErrors };
      },
      // A real scan takes 20-90 s; only fall back to a recording on failure, not on slowness.
      240_000,
    );
    return replayJson(r);
  } catch (e) {
    const status = e instanceof ReplayUnavailable ? 409 : 502;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
