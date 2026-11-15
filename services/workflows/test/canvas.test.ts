import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CanvasClient, CanvasError, canvasToQuiz } from "../../../apps/web/lib/canvas/client.js";

const fx = async (name: string) => JSON.parse(await readFile(new URL(`./fixtures/canvas/${name}.json`, import.meta.url), "utf8"));
const BASE = "https://canvas.example.edu";

/** Serves the recorded responses by path; records every request. */
async function fakeCanvas(opts: { status?: number; evilNext?: boolean } = {}) {
  const calls: { url: string; method: string; auth: string | null; body?: unknown }[] = [];
  const routes: Record<string, { body: unknown; link?: string }> = {
    "/api/v1/courses?enrollment_type=teacher&state[]=available&state[]=unpublished&per_page=50": {
      body: await fx("courses-page1"),
      link: opts.evilNext ? `<https://evil.example.com/steal?page=2>; rel="next"` : `<${BASE}/api/v1/courses?page=2&per_page=50>; rel="next", <${BASE}/api/v1/courses?page=1>; rel="first"`,
    },
    "/api/v1/courses?page=2&per_page=50": { body: await fx("courses-page2") },
    "/api/v1/courses/101/quizzes?per_page=50": { body: await fx("quizzes") },
    "/api/v1/courses/101/quizzes/501/questions?per_page=100": { body: await fx("questions") },
    "/api/v1/courses/101/assignments/9001/submissions/3001": { body: await fx("submission") },
  };
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? "GET", auth: headers.get("authorization"), ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (opts.status) return new Response("{}", { status: opts.status });
    const r = routes[u.pathname + decodeURIComponent(u.search)];
    if (!r) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(r.body), { status: 200, headers: r.link ? { link: r.link } : {} });
  };
  return { client: new CanvasClient(BASE, "test-token", fetchImpl), calls };
}

describe("Connect Canvas (recorded API responses)", () => {
  it("lists a teacher's courses across pages with the bearer token", async () => {
    const { client, calls } = await fakeCanvas();
    const courses = await client.listCourses();
    expect(courses.map((c) => c.name)).toEqual(["Intro Statistics", "Calculus I"]);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.auth === "Bearer test-token")).toBe(true);
  });

  it("imports a quiz's questions into our Items, keeping the assignment for grade passback", async () => {
    const { client } = await fakeCanvas();
    const quizzes = await client.listQuizzes(101);
    const q = quizzes[0]!;
    const questions = await client.listQuestions(101, q.id);
    const { quiz, skipped, canvas } = canvasToQuiz(questions, { quizId: "week3", courseId: "stat101", title: q.title, canvasCourseId: 101, canvasQuizId: q.id, assignmentId: q.assignment_id });
    expect(quiz.sourceFormat).toBe("canvas_api");
    expect(quiz.items.map((i) => [i.id, i.type, i.answerKey])).toEqual([
      ["week3-q1", "mcq", "b"],
      ["week3-q2", "multi", ["a", "c"]],
      ["week3-q3", "numeric", "0.1667"],
      ["week3-q4", "numeric", "46"],
    ]);
    expect(quiz.items[0]!.stem).toBe("A sample of 25 has s = 10. What is the standard error?");
    expect(quiz.items[1]!.choices![2]).toEqual({ id: "c", text: "Larger effect" });
    expect(quiz.items[0]!.objective).toBe("Standard error");
    expect(skipped).toEqual([{ title: "Explain", type: "essay_question", reason: "question type not supported yet" }]);
    expect(canvas).toEqual({ courseId: 101, quizId: 501, assignmentId: 9001 });
  });

  it("pushes a grade with a comment through the Submissions API", async () => {
    const { client, calls } = await fakeCanvas();
    const r = await client.pushGrade(101, 9001, 3001, "4", "Explained Q1 and Q3 well.");
    expect(r).toMatchObject({ score: 4, grade: "4" });
    expect(calls[0]).toMatchObject({ method: "PUT", body: { submission: { posted_grade: "4" }, comment: { text_comment: "Explained Q1 and Q3 well." } } });
  });

  it("explains a rejected token and never follows pagination to another host", async () => {
    const bad = await fakeCanvas({ status: 401 });
    await expect(bad.client.listCourses()).rejects.toThrow("Canvas rejected the token (401).");
    await expect(bad.client.listCourses()).rejects.toBeInstanceOf(CanvasError);
    const evil = await fakeCanvas({ evilNext: true });
    await expect(evil.client.listCourses()).rejects.toThrow(/another host/);
    expect(evil.calls.some((c) => c.url.includes("evil.example.com"))).toBe(false);
  });

  it("requires https", () => {
    expect(() => new CanvasClient("http://canvas.example.edu", "t")).toThrow(/https/);
  });
});
