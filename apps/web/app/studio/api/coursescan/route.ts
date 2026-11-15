// POST /studio/api/coursescan {url, consent: true} -> {card, radar}  (owner: B; scanner: A's `coursescan`)
// Crawls a public course website the professor owns or teaches (robots.txt, 1 req/s, at most 30 pages, same
// host, no LMS or login pages, at most 25 problems), then checks each posted problem against the open web.
// The ownership flag is passed only when the professor ticked the consent box. Only the scan's `record`
// (hashes and URLs, no problem text or snippets) is stored, in data/fixtures/coursescans/.
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LeakFinding } from "@unprompted/shared";
import { getViewer } from "@/lib/auth/server";
import { FIXTURES_DIR, REPO_ROOT } from "@/lib/db/fixtures";
import { buildLeakRadar } from "@/components/dashboard/leak-radar-data";
import type { CourseScanCard, CourseScanView } from "../../_lib/coursescan";
import { replayJson, ReplayUnavailable, withReplay } from "../../_lib/replay";

function runCourseScan(url: string): Promise<{ card: CourseScanCard; record: unknown }> {
  return new Promise((resolve, reject) => {
    const child = spawn("uv", ["run", "--directory", "services/agents", "coursescan", "--url", url, "--i-own-or-teach-this", "--json"], { cwd: REPO_ROOT, env: process.env });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 180_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    child.on("error", (e) => (clearTimeout(timer), reject(e)));
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out) as { card: CourseScanCard; record: unknown };
        if (!j.card) throw new Error("no card");
        resolve(j);
      } catch {
        reject(new Error(code === 0 ? "the course scan returned no result" : (err.trim().split("\n").at(-1) ?? `the course scan failed (${code})`)));
      }
    });
  });
}

export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer || viewer.role !== "professor") return Response.json({ error: "Professors only." }, { status: 403 });
  const { url, consent } = (await req.json().catch(() => ({}))) as { url?: string; consent?: boolean };
  if (consent !== true) return Response.json({ error: "Only scan sites you own or teach. Tick the box to confirm." }, { status: 400 });
  let u: URL;
  try {
    u = new URL(String(url ?? "").trim());
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    return Response.json({ error: "Enter the full address of your course page, starting with https://" }, { status: 400 });
  }
  try {
    const r = await withReplay<CourseScanView>(
      req,
      "coursescan",
      u.host + u.pathname,
      async () => {
        const { card, record } = await runCourseScan(u.toString());
        const dir = path.join(FIXTURES_DIR, "coursescans");
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, `${u.host.replace(/[^\w.-]+/g, "_")}.json`), JSON.stringify({ scannedAt: new Date().toISOString(), record }, null, 2) + "\n");
        const findings: LeakFinding[] = card.rows.flatMap((row) => row.leaks.map((f) => ({ ...f, itemId: row.id })));
        const radar = buildLeakRadar(
          { id: `course-${u.host}`, title: `Course site ${u.host}`, items: card.rows.map((row) => ({ id: row.id, quizId: "", stem: row.stem, type: "short" as const, answerKey: "", objective: "" })) },
          findings,
          { archiveWatch: { status: "off" } },
        );
        return { card, radar };
      },
      240_000,
    );
    return replayJson(r);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof ReplayUnavailable ? 409 : 502 });
  }
}
