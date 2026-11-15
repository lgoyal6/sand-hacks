// "Connect Canvas" with a teacher's API token (owner: B). Framework-free so it can be unit-tested
// with recorded Canvas API responses (services/workflows/test/canvas.test.ts); fetch is injectable.
// Classic Quizzes REST API. New Quizzes (/api/quiz/v1) is not covered yet.
import type { Item, Quiz } from "@unprompted/shared";

export interface CanvasCourse {
  id: number;
  name: string;
  course_code?: string;
}
export interface CanvasQuiz {
  id: number;
  title: string;
  question_count?: number;
  points_possible?: number | null;
  assignment_id?: number | null;
  published?: boolean;
  quiz_type?: string;
}
export interface CanvasAnswer {
  id: number;
  text?: string;
  html?: string;
  weight: number; // 100 = correct
  numerical_answer_type?: "exact_answer" | "range_answer" | "precision_answer";
  exact?: number;
  margin?: number;
  start?: number;
  end?: number;
  approximate?: number;
}
export interface CanvasQuestion {
  id: number;
  position?: number;
  question_name?: string;
  question_type: string;
  question_text: string;
  points_possible?: number;
  answers: CanvasAnswer[];
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Canvas paginates with an RFC 5988 Link header. */
function nextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1]!;
  }
  return null;
}

export class CanvasError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class CanvasClient {
  private base: string;
  constructor(
    baseUrl: string,
    private token: string,
    private fetchImpl: FetchLike = fetch,
  ) {
    const u = new URL(baseUrl);
    if (u.protocol !== "https:" && u.hostname !== "localhost") throw new Error("Canvas URL must use https");
    this.base = `${u.protocol}//${u.host}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<{ data: T; next: string | null }> {
    const url = path.startsWith("http") ? path : `${this.base}${path}`;
    // Never follow a pagination link to another host (the token would go with it).
    if (new URL(url).host !== new URL(this.base).host) throw new CanvasError("Canvas pagination pointed to another host", 0);
    const res = await this.fetchImpl(url, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      const msg = res.status === 401 ? "Canvas rejected the token (401)." : res.status === 403 ? "This token can't access that (403)." : `Canvas returned ${res.status}.`;
      throw new CanvasError(msg, res.status);
    }
    return { data: (await res.json()) as T, next: nextLink(res.headers.get("link")) };
  }

  private async all<T>(path: string, maxPages = 20): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = path;
    for (let i = 0; next && i < maxPages; i++) {
      const page: { data: T[]; next: string | null } = await this.request<T[]>(next);
      out.push(...page.data);
      next = page.next;
    }
    return out;
  }

  /** Who the token belongs to (also validates it). */
  async self(): Promise<{ id: number; name: string }> {
    return (await this.request<{ id: number; name: string }>("/api/v1/users/self")).data;
  }
  /** Courses where the token's user teaches, including unpublished ones (a new course starts unpublished). */
  listCourses(): Promise<CanvasCourse[]> {
    return this.all<CanvasCourse>("/api/v1/courses?enrollment_type=teacher&state[]=available&state[]=unpublished&per_page=50");
  }
  listQuizzes(courseId: number): Promise<CanvasQuiz[]> {
    return this.all<CanvasQuiz>(`/api/v1/courses/${courseId}/quizzes?per_page=50`);
  }
  async getQuiz(courseId: number, quizId: number): Promise<CanvasQuiz> {
    return (await this.request<CanvasQuiz>(`/api/v1/courses/${courseId}/quizzes/${quizId}`)).data;
  }
  listQuestions(courseId: number, quizId: number): Promise<CanvasQuestion[]> {
    return this.all<CanvasQuestion>(`/api/v1/courses/${courseId}/quizzes/${quizId}/questions?per_page=100`);
  }
  /** Grade passback for one student on the quiz's assignment (Submissions API). */
  async pushGrade(courseId: number, assignmentId: number, userId: number, postedGrade: string, comment?: string) {
    const body = { submission: { posted_grade: postedGrade }, ...(comment ? { comment: { text_comment: comment } } : {}) };
    return (await this.request<{ id: number; score: number | null; grade: string | null }>(`/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}`, { method: "PUT", body: JSON.stringify(body) })).data;
  }
}

// ---------------- mapping Canvas questions to our Items ----------------

function plain(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export interface CanvasImport {
  quiz: Quiz;
  skipped: { title: string; type: string; reason: string }[];
  /** Kept so grades can be pushed back to the right Canvas assignment. */
  canvas: { courseId: number; quizId: number; assignmentId: number | null };
}

export function canvasToQuiz(
  questions: CanvasQuestion[],
  meta: { quizId: string; courseId: string; title: string; canvasCourseId: number; canvasQuizId: number; assignmentId?: number | null },
): CanvasImport {
  const items: Item[] = [];
  const skipped: CanvasImport["skipped"] = [];
  const sorted = [...questions].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  for (const q of sorted) {
    const title = q.question_name && q.question_name !== "Question" ? q.question_name : "";
    const stem = plain(q.question_text);
    const base = { id: `${meta.quizId}-q${items.length + 1}`, quizId: meta.quizId, stem, objective: title || `Imported from Canvas: ${stem.slice(0, 60)}`, objectiveSource: "inferred" as const, originalItemId: null };
    const answers = q.answers ?? [];
    const letters = answers.map((_, i) => String.fromCharCode(97 + i));
    const choices = answers.map((a, i) => ({ id: letters[i]!, text: plain(a.html || a.text || "") }));
    if (q.question_type === "multiple_choice_question" || q.question_type === "true_false_question") {
      const i = answers.findIndex((a) => a.weight >= 100);
      if (i < 0) {
        skipped.push({ title: title || stem.slice(0, 40), type: q.question_type, reason: "no correct answer marked" });
        continue;
      }
      items.push({ ...base, type: "mcq", choices, answerKey: letters[i]! });
    } else if (q.question_type === "multiple_answers_question") {
      const keys = answers.flatMap((a, i) => (a.weight > 0 ? [letters[i]!] : []));
      if (!keys.length) {
        skipped.push({ title: title || stem.slice(0, 40), type: q.question_type, reason: "no correct answers marked" });
        continue;
      }
      items.push({ ...base, type: "multi", choices, answerKey: keys });
    } else if (q.question_type === "numerical_question") {
      const a = answers.find((x) => x.weight >= 100) ?? answers[0];
      const v =
        a?.numerical_answer_type === "range_answer" && a.start != null && a.end != null
          ? (a.start + a.end) / 2
          : a?.numerical_answer_type === "precision_answer"
            ? a.approximate
            : a?.exact;
      if (v == null || !Number.isFinite(v)) {
        skipped.push({ title: title || stem.slice(0, 40), type: q.question_type, reason: "no numeric answer" });
        continue;
      }
      items.push({ ...base, type: "numeric", answerKey: String(v) });
    } else {
      skipped.push({ title: title || stem.slice(0, 40), type: q.question_type, reason: "question type not supported yet" });
    }
  }
  return {
    quiz: { id: meta.quizId, courseId: meta.courseId, title: meta.title, sourceFormat: "canvas_api", items },
    skipped,
    canvas: { courseId: meta.canvasCourseId, quizId: meta.canvasQuizId, assignmentId: meta.assignmentId ?? null },
  };
}
