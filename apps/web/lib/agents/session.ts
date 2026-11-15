// Server-side session facts for agent turns (owner: B). The browser never decides the mode:
// it comes from the attempt record (Neon, else the fixture), and anything unknown is "graded".
import "server-only";
import path from "node:path";
import { neon } from "@/lib/db/neon";
import { FIXTURES_DIR, readJson } from "@/lib/db/fixtures";

export interface AgentSession {
  mode: "practice" | "graded";
  quizId?: string;
  source: "neon" | "fixture" | "none";
}

export async function sessionFor(attemptId: string | undefined): Promise<AgentSession> {
  if (!attemptId) return { mode: "graded", source: "none" };
  const db = neon();
  if (db) {
    try {
      const r = await db.query<{ mode: string; quiz_id: string }>("select mode, quiz_id from attempt where id = $1", [attemptId]);
      const a = r.rows[0];
      if (a) return { mode: a.mode === "practice" ? "practice" : "graded", quizId: a.quiz_id, source: "neon" };
    } catch (e) {
      console.error("[agents] attempt lookup failed:", (e as Error).message);
    }
  }
  const all = await readJson<{ id: string; mode?: string; quizId?: string }[]>(path.join(FIXTURES_DIR, "attempts.json"), []);
  const a = all.find((x) => x.id === attemptId);
  if (a) return { mode: a.mode === "practice" ? "practice" : "graded", quizId: a.quizId, source: "fixture" };
  return { mode: "graded", source: "none" };
}
