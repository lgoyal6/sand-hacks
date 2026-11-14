import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gradeItem, parseNumber } from "../grade.mjs";
import { start } from "../server.mjs";

test("parseNumber", () => {
  assert.equal(parseNumber("1/6"), 1 / 6);
  assert.equal(parseNumber("50%"), 0.5);
  assert.equal(parseNumber(" 2 "), 2);
  assert.ok(Number.isNaN(parseNumber("one sixth")));
});

test("gradeItem numeric tolerance", () => {
  const item = { type: "numeric", answerKey: "1/6" };
  assert.ok(gradeItem(item, "1/6"));
  assert.ok(gradeItem(item, "2/12"));
  assert.ok(gradeItem(item, "0.1667"));
  assert.ok(gradeItem(item, "0.167"));
  assert.ok(!gradeItem(item, "0.17"));
  assert.ok(!gradeItem(item, ""));
});

test("gradeItem mcq / multi / short", () => {
  assert.ok(gradeItem({ type: "mcq", answerKey: "b" }, "b"));
  assert.ok(!gradeItem({ type: "mcq", answerKey: "b" }, "a"));
  assert.ok(gradeItem({ type: "multi", answerKey: ["a", "c"] }, ["c", "a"]));
  assert.ok(!gradeItem({ type: "multi", answerKey: ["a", "c"] }, "a"));
  assert.ok(gradeItem({ type: "short", answerKey: ["Median"] }, " median "));
});

let server, base;
before(async () => {
  server = await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test("full flow: login with run id, take quiz, results graded server-side", async () => {
  const login = await fetch(`${base}/login`, {
    method: "POST",
    body: new URLSearchParams({ username: "student1", password: "sandbox", run: "run-test" }),
    redirect: "manual",
  });
  assert.equal(login.status, 303);
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const quizPage = await (await fetch(`${base}/quiz/stats-101`, { headers: { cookie } })).text();
  assert.ok(!quizPage.includes("answerKey"), "page must not leak keys");
  const attemptId = quizPage.match(/name="attemptId" value="([^"]+)"/)[1];

  await fetch(`${base}/api/attempts/${attemptId}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId: "stats-101-q1", value: "b" }),
  });

  const form = new URLSearchParams({ attemptId, "stats-101-q1": "b", "stats-101-q2": "a", "stats-101-q3": "1/6" });
  const submit = await fetch(`${base}/quiz/stats-101/submit`, { method: "POST", headers: { cookie }, body: form });
  assert.equal(submit.status, 200);

  const run = await (await fetch(`${base}/api/runs/run-test`)).json();
  assert.equal(run.attempts.length, 1);
  const byId = Object.fromEntries(run.attempts[0].items.map((i) => [i.itemId, i]));
  assert.equal(byId["stats-101-q1"].correct, true);
  assert.equal(byId["stats-101-q2"].correct, false);
  assert.equal(byId["stats-101-q3"].correct, true);
  assert.equal(byId["stats-101-q4"].answered, false);
  assert.equal(byId["stats-101-q1"].answerChanges, 1);
});

test("register a variant quiz", async () => {
  const quiz = { id: "v-1", courseId: "c", title: "Variant", sourceFormat: "markdown", items: [{ id: "v-1-q1", quizId: "v-1", type: "short", stem: "Say hi", answerKey: "hi", objective: "x" }] };
  const r = await fetch(`${base}/api/quizzes`, { method: "POST", body: JSON.stringify(quiz) });
  assert.equal(r.status, 201);
  assert.match((await r.json()).url, /\/quiz\/v-1$/);
});
