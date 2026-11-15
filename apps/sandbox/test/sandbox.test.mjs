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

const RUNNER = { "x-runner-token": "dev-runner-token" };
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

  const quizPage = await (await fetch(`${base}/quiz/sample-stats`, { headers: { cookie } })).text();
  assert.ok(!quizPage.includes("answerKey"), "page must not leak keys");
  const attemptId = quizPage.match(/name="attemptId" value="([^"]+)"/)[1];

  await fetch(`${base}/api/attempts/${attemptId}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId: "sample-stats-q1", value: "b" }),
  });

  const form = new URLSearchParams({ attemptId, "sample-stats-q1": "b", "sample-stats-q2": "a", "sample-stats-q3": "1/6" });
  const submit = await fetch(`${base}/quiz/sample-stats/submit`, { method: "POST", headers: { cookie }, body: form });
  assert.equal(submit.status, 200);

  assert.equal((await fetch(`${base}/api/runs/run-test`)).status, 403, "agent without token can't read results");
  const run = await (await fetch(`${base}/api/runs/run-test`, { headers: RUNNER })).json();
  assert.equal(run.attempts.length, 1);
  const byId = Object.fromEntries(run.attempts[0].items.map((i) => [i.itemId, i]));
  assert.equal(byId["sample-stats-q1"].correct, true);
  assert.equal(byId["sample-stats-q2"].correct, false);
  assert.equal(byId["sample-stats-q3"].correct, true);
  assert.equal(byId["sample-stats-q4"].answered, false);
  assert.equal(byId["sample-stats-q1"].answerChanges, 1);
});

test("register a variant quiz", async () => {
  const quiz = { id: "v-1", courseId: "c", title: "Variant", sourceFormat: "markdown", items: [{ id: "v-1-q1", quizId: "v-1", type: "short", stem: "Say hi", answerKey: "hi", objective: "x" }] };
  const r = await fetch(`${base}/api/quizzes`, { method: "POST", headers: RUNNER, body: JSON.stringify(quiz) });
  assert.equal(r.status, 201);
  assert.match((await r.json()).url, /\/quiz\/v-1$/);
});

test("figure items render an img, only from data: URLs or /figures/", async () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const quiz = { id: "fig-1", courseId: "c", title: "Fig", sourceFormat: "markdown", items: [
    { id: "fig-1-q1", quizId: "fig-1", type: "numeric", stem: "Read the slope from the chart.", answerKey: "2", objective: "x", figure: { src: png, alt: "A line chart" } },
    { id: "fig-1-q2", quizId: "fig-1", type: "numeric", stem: "Bad src.", answerKey: "1", objective: "x", figure: { src: "https://example.com/x.png", alt: "" } },
    { id: "fig-1-q3", quizId: "fig-1", type: "numeric", stem: "No alt.", answerKey: "3", objective: "x", image: { src: png } },
  ] };
  assert.equal((await fetch(`${base}/api/quizzes`, { method: "POST", headers: RUNNER, body: JSON.stringify(quiz) })).status, 201);
  const login = await fetch(`${base}/login`, { method: "POST", body: new URLSearchParams({ username: "student1", password: "sandbox" }), redirect: "manual" });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const html = await (await fetch(`${base}/quiz/fig-1`, { headers: { cookie } })).text();
  assert.ok(html.includes(`<img src="${png}" alt="A line chart"`));
  assert.ok(!html.includes("example.com"), "remote figure URLs are not rendered");
  assert.ok(html.includes(`<img src="${png}" alt=""`), "image alias renders with empty alt");
});
