// Unprompted sandbox quiz site (workstream A).
// A deliberately plain, LMS-like quiz page that OUR OWN agents attack. Never point agents at real courses.
// Zero dependencies: node:http only. Grading happens server-side; the page never sees answer keys.
import http from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { gradeItem } from "./grade.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SANDBOX_PORT ?? 3101);
export const STUDENT = { username: "student1", password: "sandbox" };
// The runner API (/api/runs, /api/quizzes) needs this header so the attacking agent, which can run code in the page,
// can't grade itself. Set the same SANDBOX_RUNNER_TOKEN for the sandbox and the runner.
const RUNNER_TOKEN = process.env.SANDBOX_RUNNER_TOKEN ?? "dev-runner-token";

/** quizId -> Quiz (shape: packages/shared Quiz) */
const quizzes = new Map();
for (const f of readdirSync(path.join(here, "quizzes")).filter((f) => f.endsWith(".json"))) {
  const q = JSON.parse(readFileSync(path.join(here, "quizzes", f), "utf8"));
  quizzes.set(q.id, q);
}

/** sessionId -> { user, runId } */
const sessions = new Map();
/** attemptId -> { id, quizId, runId, startedAt, events: [{ts,itemId,value}], submittedAt, answers, results } */
const attempts = new Map();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie ?? "").split(";").filter(Boolean).map((c) => c.trim().split("=").map(decodeURIComponent)));
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 1e6) throw new Error("body too large");
  }
  return data;
}

function parseForm(body) {
  const out = {};
  for (const [k, v] of new URLSearchParams(body)) {
    if (k in out) out[k] = [].concat(out[k], v);
    else out[k] = v;
  }
  return out;
}

function send(res, status, body, type = "text/html; charset=utf-8", headers = {}) {
  res.writeHead(status, { "content-type": type, ...headers });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj, null, 2), "application/json");
const redirect = (res, to, headers = {}) => send(res, 303, "", "text/plain", { location: to, ...headers });

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | Course Sandbox</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f5f5f5;color:#222}
  header{background:#2d3b45;color:#fff;padding:12px 24px;font-weight:600}
  main{max-width:760px;margin:24px auto;background:#fff;padding:24px 32px;border:1px solid #ddd;border-radius:4px}
  .question{border:1px solid #ccc;border-radius:4px;margin:16px 0;padding:16px}
  .question h3{margin:0 0 8px;font-size:15px;color:#555}
  .stem{margin:0 0 12px}
  label{display:block;margin:6px 0;cursor:pointer}
  input[type=text],input[type=password]{padding:6px 8px;font-size:15px;border:1px solid #aaa;border-radius:3px}
  button{background:#0374b5;color:#fff;border:0;padding:8px 18px;font-size:15px;border-radius:3px;cursor:pointer}
  .muted{color:#666;font-size:14px}
</style></head><body><header>Course Sandbox</header><main>${body}</main></body></html>`;
}

function currentSession(req) {
  const sid = parseCookies(req).sid;
  return sid && sessions.get(sid) ? { sid, ...sessions.get(sid) } : null;
}

function renderItem(item, idx) {
  const n = idx + 1;
  let input;
  if (item.type === "mcq" || item.type === "multi") {
    const t = item.type === "mcq" ? "radio" : "checkbox";
    input = item.choices
      .map((c) => `<label><input type="${t}" name="${esc(item.id)}" value="${esc(c.id)}"> ${esc(c.text)}</label>`)
      .join("");
  } else {
    input = `<label>Answer: <input type="text" name="${esc(item.id)}" autocomplete="off"></label>`;
  }
  return `<section class="question" data-item-id="${esc(item.id)}"><h3>Question ${n}</h3><p class="stem">${esc(item.stem)}</p>${renderFigure(item)}${input}</section>`;
}

// Optional figure for figure-dependent variants: item.figure = { src, alt }. src is a data:image URL or a path
// served from /figures/. alt is rendered as given; whoever writes the variant decides what it contains (a figure
// whose alt text holds the data is readable to agents and screen readers alike).
function renderFigure(item) {
  const f = item.figure ?? item.image; // B's shared type calls it `image`; `figure` kept as an alias
  if (!f || typeof f.src !== "string") return "";
  if (!/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(f.src) && !/^\/figures\/[\w.-]+$/.test(f.src)) return "";
  return `<figure class="figure"><img src="${esc(f.src)}" alt="${esc(f.alt ?? "")}" style="max-width:100%"></figure>`;
}

// Answer-change events let us time each item without trusting the agent's own report.
const quizScript = (attemptId) => `<script>
document.querySelectorAll('.question input').forEach(function(el){
  el.addEventListener(el.type==='text'?'input':'change', function(){
    var sec = el.closest('.question'); var itemId = sec.dataset.itemId; var value;
    if (el.type==='checkbox') value = Array.from(sec.querySelectorAll('input:checked')).map(function(x){return x.value});
    else value = el.value;
    fetch('/api/attempts/${attemptId}/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({itemId:itemId,value:value})});
  });
});
</script>`;

export function attemptResults(attempt) {
  const quiz = quizzes.get(attempt.quizId);
  const start = Date.parse(attempt.startedAt);
  // seconds per item: from the previous item's last answer change (or attempt start) to this item's last change.
  const lastChange = {};
  for (const e of attempt.events) lastChange[e.itemId] = Date.parse(e.ts);
  const order = Object.entries(lastChange).sort((a, b) => a[1] - b[1]);
  const seconds = {};
  let prev = start;
  for (const [itemId, t] of order) {
    seconds[itemId] = Math.max(0, (t - prev) / 1000);
    prev = t;
  }
  // Last value the page reported per item. Only used for unsubmitted attempts ("answered, not submitted"), so a run
  // that picked the right answers but never pressed Submit is diagnosable instead of looking wrong.
  const lastValue = {};
  for (const e of attempt.events) lastValue[e.itemId] = e.value;
  return quiz.items.map((item) => {
    const answer = attempt.answers?.[item.id] ?? null;
    const pending = !attempt.answers && item.id in lastValue ? lastValue[item.id] : undefined;
    return {
      ...(pending !== undefined ? { pendingAnswer: pending, pendingCorrect: gradeItem(item, pending) } : {}),
      itemId: item.id,
      answer,
      answered: answer !== null && answer !== "" && !(Array.isArray(answer) && answer.length === 0),
      correct: attempt.answers ? gradeItem(item, answer) : false,
      seconds: seconds[item.id] ?? null,
      answerChanges: attempt.events.filter((e) => e.itemId === item.id).length,
    };
  });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const sess = currentSession(req);

  // ---------- runner API (not linked from the UI) ----------
  if (p === "/api/health") return json(res, 200, { ok: true, quizzes: [...quizzes.keys()], figures: true });

  let fm;
  if ((fm = p.match(/^\/figures\/([\w.-]+\.(png|jpe?g|gif|webp|svg))$/))) {
    try {
      const type = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" }[fm[2]];
      return send(res, 200, readFileSync(path.join(here, "figures", fm[1])), type);
    } catch {
      return send(res, 404, "not found", "text/plain");
    }
  }

  const isRunner = req.headers["x-runner-token"] === RUNNER_TOKEN;
  if ((p === "/api/quizzes" || p.startsWith("/api/runs/")) && !isRunner) return json(res, 403, { error: "runner token required" });

  if (p === "/api/quizzes" && req.method === "POST") {
    // Register a quiz (e.g. B's variant candidates) so agents can attack it. Body: Quiz.
    const q = JSON.parse(await readBody(req));
    if (!q.id || !Array.isArray(q.items) || q.items.length === 0) return json(res, 400, { error: "quiz needs id and items" });
    for (const it of q.items) {
      if (!it.id || !it.stem || !it.type || it.answerKey === undefined) return json(res, 400, { error: `bad item ${it.id}` });
      const fig = it.figure ?? it.image;
      if (fig && (typeof fig.src !== "string" || fig.src.length > 2_000_000)) return json(res, 400, { error: `bad image on ${it.id}` });
    }
    quizzes.set(q.id, q);
    return json(res, 201, { id: q.id, url: `http://localhost:${PORT}/quiz/${encodeURIComponent(q.id)}` });
  }

  let m;
  if ((m = p.match(/^\/api\/runs\/([^/]+)$/))) {
    // All attempts tagged with this runId, graded.
    const list = [...attempts.values()].filter((a) => a.runId === m[1]);
    return json(res, 200, {
      runId: m[1],
      attempts: list.map((a) => ({ attemptId: a.id, quizId: a.quizId, startedAt: a.startedAt, submittedAt: a.submittedAt ?? null, items: attemptResults(a) })),
    });
  }

  if ((m = p.match(/^\/api\/attempts\/([^/]+)\/events$/)) && req.method === "POST") {
    const a = attempts.get(m[1]);
    if (!a || a.submittedAt) return json(res, 404, { error: "no open attempt" });
    const { itemId, value } = JSON.parse(await readBody(req));
    a.events.push({ ts: new Date().toISOString(), itemId, value });
    return json(res, 200, { ok: true });
  }

  // ---------- student-facing pages ----------
  if (p === "/" || p === "/login") {
    // ?run=<id> tags everything this browser does with the runner's run id.
    const run = url.searchParams.get("run") ?? "";
    if (req.method === "POST") {
      const form = parseForm(await readBody(req));
      if (form.username === STUDENT.username && form.password === STUDENT.password) {
        const sid = randomUUID();
        sessions.set(sid, { user: form.username, runId: form.run || null });
        return redirect(res, "/courses", { "set-cookie": `sid=${sid}; Path=/; HttpOnly; SameSite=Lax` });
      }
      return send(res, 401, page("Log in", `<h1>Log in</h1><p>Wrong username or password.</p><a href="/login">Try again</a>`));
    }
    if (sess) return redirect(res, "/courses");
    return send(res, 200, page("Log in", `<h1>Log in</h1>
<form method="post" action="/login">
  <input type="hidden" name="run" value="${esc(run)}">
  <p><label>Username <input type="text" name="username" autocomplete="username"></label></p>
  <p><label>Password <input type="password" name="password" autocomplete="current-password"></label></p>
  <button type="submit">Log in</button>
</form>
<p class="muted">Sandbox account for testing: ${STUDENT.username} / ${STUDENT.password}</p>`));
  }

  if (!sess) return redirect(res, "/login");

  if (p === "/courses") {
    const links = [...quizzes.values()]
      .map((q) => `<li><a href="/quiz/${encodeURIComponent(q.id)}">${esc(q.title)}</a> <span class="muted">(${q.items.length} questions)</span></li>`)
      .join("");
    return send(res, 200, page("Quizzes", `<h1>Quizzes</h1><ul>${links}</ul>`));
  }

  if ((m = p.match(/^\/quiz\/([^/]+)$/)) && req.method === "GET") {
    const quiz = quizzes.get(decodeURIComponent(m[1]));
    if (!quiz) return send(res, 404, page("Not found", "<h1>Quiz not found</h1>"));
    const attempt = { id: randomUUID(), quizId: quiz.id, runId: sess.runId, startedAt: new Date().toISOString(), events: [] };
    attempts.set(attempt.id, attempt);
    return send(res, 200, page(quiz.title, `<h1>${esc(quiz.title)}</h1>
<p class="muted">${quiz.items.length} questions. Answer all of them, then press Submit quiz.</p>
<form method="post" action="/quiz/${encodeURIComponent(quiz.id)}/submit">
<input type="hidden" name="attemptId" value="${attempt.id}">
${quiz.items.map(renderItem).join("")}
<button type="submit">Submit quiz</button>
</form>${quizScript(attempt.id)}`));
  }

  if ((m = p.match(/^\/quiz\/([^/]+)\/submit$/)) && req.method === "POST") {
    const form = parseForm(await readBody(req));
    const a = attempts.get(form.attemptId);
    if (!a || a.submittedAt) return send(res, 400, page("Error", "<h1>This attempt was already submitted or doesn't exist.</h1>"));
    const quiz = quizzes.get(a.quizId);
    a.answers = Object.fromEntries(quiz.items.map((it) => [it.id, form[it.id] ?? null]));
    a.submittedAt = new Date().toISOString();
    // Like many LMS quizzes, don't reveal per-question correctness after submitting.
    return send(res, 200, page("Submitted", `<h1>Quiz submitted</h1><p>Your answers were recorded. Attempt id: <code>${a.id}</code></p><p><a href="/courses">Back to quizzes</a></p>`));
  }

  return send(res, 404, page("Not found", "<h1>Not found</h1>"));
}

export function start(port = PORT) {
  const server = http.createServer((req, res) =>
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: String(err.message ?? err) });
    }),
  );
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().then(() => console.log(`sandbox on http://localhost:${PORT}  (login ${STUDENT.username}/${STUDENT.password})`));
}
