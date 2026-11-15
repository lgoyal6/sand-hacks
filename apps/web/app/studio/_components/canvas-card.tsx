"use client";
// Connect Canvas card (owner: B). Canvas Classic Quizzes only. The token goes to our server once and is
// never sent back; grade push is marked untested until we try it against a live Canvas.
import { useEffect, useState } from "react";
import { PillButton } from "@/components/ui/chat";

type Course = { id: number; name: string; course_code?: string };
type CQuiz = { id: number; title: string; question_count?: number; assignment_id?: number | null; published?: boolean };
type Imported = { quizId: string; title: string; items: number; skipped?: { title: string; type: string }[]; canvas?: { courseId: number; quizId: number; assignmentId: number | null } };

async function call<T>(body: object): Promise<T> {
  const r = await fetch("/studio/api/canvas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `Canvas request failed (${r.status})`);
  return j;
}

const field = "h-9 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CanvasCard({ onImported }: { onImported: (r: Imported) => void }) {
  const [status, setStatus] = useState<{ connected: boolean; source?: string; baseUrl?: string } | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [quizzes, setQuizzes] = useState<CQuiz[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<Imported | null>(null);
  const [grade, setGrade] = useState({ userId: "", grade: "", comment: "" });
  const [gradeResult, setGradeResult] = useState<string | null>(null);

  const run = async <T,>(label: string, f: () => Promise<T>) => {
    setBusy(label);
    setError(null);
    try {
      return await f();
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const loadCourses = () => void run("Loading your courses", () => call<Course[]>({ action: "courses" })).then((c) => c && setCourses(c));
  useEffect(() => {
    fetch("/studio/api/canvas")
      .then((r) => r.json())
      .then((s: { connected: boolean; source?: string; baseUrl?: string }) => {
        setStatus(s);
        if (s.connected) loadCourses();
      })
      .catch(() => setStatus({ connected: false }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="overflow-hidden rounded-[20px] border border-border bg-background">
      <div className="px-4 pb-2 pt-3.5">
        <p className="text-[15px] font-medium">Canvas Classic Quizzes (QTI 1.2)</p>
        <p className="text-xs text-muted-foreground">Import a quiz from a Canvas course, rewrite it here, and export it back. New Quizzes aren&apos;t supported yet.</p>
      </div>
      <div className="space-y-3 border-t border-border px-4 py-3 text-sm">
        {!status ? (
          <p className="text-muted-foreground">Checking the connection…</p>
        ) : !status.connected ? (
          <form
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await run("Connecting", () => call<{ name: string }>({ action: "connect", baseUrl, token }));
              if (r) {
                setToken("");
                setStatus({ connected: true, source: "pasted", baseUrl });
                loadCourses();
              }
            }}
          >
            <input className={field} placeholder="https://canvas.youruniversity.edu" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} aria-label="Canvas URL" />
            <input className={field} type="password" autoComplete="off" placeholder="Canvas access token" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Canvas access token" />
            <p className="text-xs text-muted-foreground">
              In Canvas: Account, Settings, New Access Token. The token is sent once to this server, kept in memory for this session only, and never shown again or saved.
            </p>
            <PillButton variant="primary" type="submit" disabled={!baseUrl || !token || !!busy}>
              Connect
            </PillButton>
          </form>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Connected to {status.baseUrl}
              {status.source === "env" ? " (server configuration)" : ""}.
            </p>
            {courses ? (
              <div className="flex flex-wrap gap-2">
                {courses.map((c) => (
                  <PillButton
                    key={c.id}
                    variant={course?.id === c.id ? "primary" : "secondary"}
                    onClick={async () => {
                      setCourse(c);
                      setQuizzes(null);
                      const q = await run("Loading quizzes", () => call<CQuiz[]>({ action: "quizzes", courseId: c.id }));
                      if (q) setQuizzes(q);
                    }}
                  >
                    {c.course_code || c.name}
                  </PillButton>
                ))}
                {!courses.length ? <p className="text-muted-foreground">No courses where you teach.</p> : null}
              </div>
            ) : null}
            {course && quizzes ? (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {quizzes.map((q) => (
                  <li key={q.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate">
                      {q.title}
                      <span className="text-xs text-muted-foreground"> · {q.question_count ?? "?"} questions{q.published === false ? " · unpublished" : ""}</span>
                    </span>
                    <PillButton
                      variant="secondary"
                      disabled={!!busy}
                      onClick={async () => {
                        const r = await run("Importing", () => call<Imported>({ action: "import", courseId: course.id, quizId: q.id }));
                        if (r) {
                          setImported(r);
                          onImported(r);
                        }
                      }}
                    >
                      Import
                    </PillButton>
                  </li>
                ))}
                {!quizzes.length ? <li className="px-3 py-2 text-muted-foreground">No Classic Quizzes in this course.</li> : null}
              </ul>
            ) : null}
            {imported?.canvas?.assignmentId ? (
              <details className="rounded-xl border border-dashed border-border px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium">Push a grade to Canvas (untested against a live Canvas)</summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr]">
                  <input className={field} placeholder="Canvas user id" value={grade.userId} onChange={(e) => setGrade({ ...grade, userId: e.target.value })} />
                  <input className={field} placeholder="Grade, e.g. 4" value={grade.grade} onChange={(e) => setGrade({ ...grade, grade: e.target.value })} />
                  <input className={`${field} sm:col-span-2`} placeholder="Comment (optional)" value={grade.comment} onChange={(e) => setGrade({ ...grade, comment: e.target.value })} />
                </div>
                <PillButton
                  variant="secondary"
                  className="mt-2"
                  disabled={!grade.userId || !grade.grade || !!busy}
                  onClick={async () => {
                    const r = await run("Pushing the grade", () =>
                      call<{ score: number | null }>({ action: "grade", courseId: imported.canvas!.courseId, assignmentId: imported.canvas!.assignmentId, userId: Number(grade.userId), grade: grade.grade, comment: grade.comment || undefined }),
                    );
                    if (r) setGradeResult(`Canvas recorded a score of ${r.score ?? "?"}.`);
                  }}
                >
                  Push grade
                </PillButton>
                {gradeResult ? <p className="mt-1 text-xs text-muted-foreground">{gradeResult}</p> : null}
              </details>
            ) : null}
          </>
        )}
        {busy ? <p className="text-xs text-muted-foreground">{busy}…</p> : null}
        {error ? <p className="text-xs text-rejected">{error}</p> : null}
      </div>
    </div>
  );
}
