// Critical-flow smoke tests. ZERO LLM calls:
// - The one model-backed request on these paths, POST /api/probes/:id/counterfactual, is stubbed with page.route,
//   so a cache miss can never fall through to Gemini. Everything else is real (server grading, telemetry, probes).
// - Rows are tagged studentPseudonym "e2e-<ts>" and never deleted.
import { test, expect, type Page, type Response } from "@playwright/test";
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(here, "../../.env.local"), quiet: true });

const RUNNER_TOKEN = process.env.SANDBOX_RUNNER_TOKEN ?? "dev-runner-token";
const QUIZ = "sample-stats";
// Answers for our own sample quiz (data/quizzes/sample-stats.md). Kept fixed so cached paths are hit.
const ANSWERS: Record<string, { choice?: string; text?: string }> = {
  [`${QUIZ}-q1`]: { choice: "b" },
  [`${QUIZ}-q2`]: { choice: "b" },
  [`${QUIZ}-q3`]: { text: "1/6" },
  [`${QUIZ}-q4`]: { choice: "b" },
  [`${QUIZ}-q5`]: { choice: "b" },
};
const STUB_CF = "E2E stub: suppose the sample size doubled. What changes, and why?";

async function blockLLM(page: Page) {
  await page.route("**/api/probes/*/counterfactual", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ prompt: STUB_CF, source: "e2e-stub" }) }),
  );
}

test("home page loads", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.locator("body")).toContainText(/Unprompted|Intro Statistics|studio/i);
});

test("professor studio loads", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const res = await page.goto("/studio");
  expect(res?.status()).toBe(200);
  await expect(page.locator("main, body").first()).not.toBeEmpty();
  expect(errors, "uncaught page errors on /studio").toEqual([]);
});

test("practice quiz: answer all 5, feedback, typed probe, telemetry lands", async ({ page, request }) => {
  const student = `e2e-${Date.now()}`;
  await blockLLM(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const telemetry: { accepted: number; sink: string }[] = [];
  const apiFailures: string[] = [];
  page.on("response", async (r: Response) => {
    if (new URL(r.url()).pathname.startsWith("/api/") && r.status() >= 400) {
      apiFailures.push(`${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()} ${(await r.text().catch(() => "")).slice(0, 200)}`);
    }
    if (/\/api\/telemetry\/[\w-]+$/.test(new URL(r.url()).pathname) && r.request().method() === "POST") {
      telemetry.push(await r.json().catch(() => ({ accepted: 0, sink: "?" })));
    }
  });

  await page.goto(`/quiz/${QUIZ}?mode=practice&student=${student}`);
  await page.locator("#start-practice").click();

  let probes = 0;
  for (let n = 1; n <= 5; n++) {
    const itemId = `${QUIZ}-q${n}`;
    const item = page.locator(`#item-${itemId}`);
    await expect(item, `question ${n} visible`).toBeVisible();
    const a = ANSWERS[itemId];
    if (a.choice) await item.locator(`#choice-${a.choice}`).click();
    else {
      await page.locator("#answer-input").click();
      await page.locator("#answer-input").pressSequentially(a.text!, { delay: 40 }); // real key events
    }
    await page.locator("#submit-answer").click();

    // Either a probe opens (before feedback) or feedback shows directly.
    const probe = page.locator("#probe");
    const feedback = page.locator("#item-feedback");
    await expect(probe.or(feedback)).toBeVisible();
    if (await probe.isVisible()) {
      probes++;
      await runTypedProbe(page, apiFailures);
    }
    await expect(feedback, `feedback for question ${n}`).toBeVisible();
    await expect(feedback).toHaveAttribute("data-correct", "true");
    await page.locator(n < 5 ? "#next-item" : "#finish-quiz").click();
  }

  await expect(page.locator("#quiz-done")).toBeVisible();
  await expect(page.locator("#quiz-score")).toContainText("5");
  expect(probes, "practice mode opens at least one probe").toBeGreaterThanOrEqual(1);
  expect(pageErrors, "uncaught page errors").toEqual([]);
  expect(apiFailures, "API calls that failed").toEqual([]);

  // Server side: the attempt exists under our pseudonym and every answer was graded correct.
  const res = await request.get(`/api/attempts?student=${student}`, { headers: { "x-runner-token": RUNNER_TOKEN } });
  expect(res.status()).toBe(200);
  const { attempts } = await res.json();
  expect(attempts).toHaveLength(1);
  const attempt = attempts[0];
  expect(attempt.finishedAt).toBeTruthy();
  expect(attempt.responses.map((r: { correct: boolean }) => r.correct)).toEqual([true, true, true, true, true]);

  // Telemetry: the client batches flushed, and rows exist for this attempt in the sink they report.
  await expect.poll(() => telemetry.reduce((s, t) => s + (t.accepted ?? 0), 0), { timeout: 15_000 }).toBeGreaterThan(0);
  const sinks = new Set(telemetry.map((t) => t.sink));
  if (sinks.has("tiger") && process.env.TIGER_DATABASE_URL) {
    const db = new pg.Client({ connectionString: libpqSsl(process.env.TIGER_DATABASE_URL) });
    await db.connect();
    try {
      const { rows } = await db.query("select count(*)::int as n from interaction_events where attempt_id = $1", [attempt.attemptId]);
      expect(rows[0].n, `Tiger rows for ${attempt.attemptId}`).toBeGreaterThan(0);
    } finally {
      await db.end();
    }
  } else {
    test.info().annotations.push({ type: "telemetry-sink", description: [...sinks].join(",") + " (Tiger not checked)" });
  }
});

// Same as apps/web/lib/db/tiger.ts: Tiger's sslmode=require means "encrypt, don't verify" (libpq semantics).
function libpqSsl(url: string) {
  const u = new URL(url);
  if (u.searchParams.get("sslmode") === "require" && !u.searchParams.has("uselibpqcompat")) u.searchParams.set("uselibpqcompat", "true");
  return u.toString();
}

async function runTypedProbe(page: Page, apiFailures: string[]) {
  const probe = page.locator("#probe");
  await page.locator("#probe-type").click(); // typed fallback, no microphone
  await expect(probe).toHaveAttribute("data-step", "before");
  await page.locator(`label[for="confidence-before-5"]`).click(); // the radio is sr-only; people click the label
  await page.locator("#probe-begin").click();
  await expect(probe).toHaveAttribute("data-step", "explain");
  await page.locator("#probe-explanation").fill("E2E smoke test explanation: I used the formula from the lecture.");
  await page.locator("#probe-submit-explanation").click();
  await expect(probe).toHaveAttribute("data-step", "cf");
  await expect(page.locator("#probe-counterfactual")).toContainText("E2E stub");
  await page.locator("#probe-cf-answer").fill("E2E smoke test counterfactual answer.");
  await page.locator("#probe-submit-cf").click();
  await expect(probe).toHaveAttribute("data-step", "after");
  await page.locator(`label[for="confidence-after-4"]`).click();
  const saved = page.waitForResponse((r) => /\/api\/probes\/[\w-]+$/.test(new URL(r.url()).pathname) && r.request().method() === "PATCH");
  await page.locator("#probe-finish").click();
  const patch = await saved;
  expect(patch.status(), `probe save failed: ${apiFailures.join(" | ")}`).toBeLessThan(400);
  await expect(probe).toHaveAttribute("data-step", "done");
  await page.locator("#probe-continue").click();
}
