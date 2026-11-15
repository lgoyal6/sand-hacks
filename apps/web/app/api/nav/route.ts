// Sidebar data (owner: D): who is signed in (name, role, demo; never the email) and the classes they can switch
// between, each with its quizzes. Students see published quizzes only. Public route: returns viewer null when
// signed out. Reading this never touches the session, so switching class can't sign anyone out.
import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/server";
import { neon } from "@/lib/db/neon";

export interface NavClass {
  id: string;
  title: string;
  quizzes: { id: string; title: string }[];
}

export async function GET() {
  const viewer = await getViewer();
  const classes: NavClass[] = [];
  const db = neon();
  if (db && viewer) {
    try {
      const { rows } = await db.query<{ id: string; title: string; qid: string | null; qtitle: string | null; published: boolean | null }>(
        `select c.id, c.title, q.id as qid, q.title as qtitle, q.published
           from course c left join quiz q on q.course_id = c.id
          order by c.title, q.title`,
      );
      const by = new Map<string, NavClass>();
      for (const r of rows) {
        let c = by.get(r.id);
        if (!c) by.set(r.id, (c = { id: r.id, title: r.title, quizzes: [] }));
        if (r.qid && (viewer.role === "professor" || r.published)) c.quizzes.push({ id: r.qid, title: (r.qtitle ?? r.qid).replace(/^[^:]*:\s*/, "") });
      }
      // Students only see classes that have something to take.
      classes.push(...[...by.values()].filter((c) => viewer.role === "professor" || c.quizzes.length));
    } catch (e) {
      console.error("[nav] classes failed:", (e as Error).message);
    }
  }
  return NextResponse.json(
    { viewer: viewer ? { name: viewer.name, role: viewer.role, demo: viewer.demo } : null, classes },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
