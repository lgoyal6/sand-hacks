// Stagehand runner (workstream A). Called by the Python attack CLI (runners.run_stagehand).
//
// Stagehand v4 has no autonomous agent; students script it with act/observe/extract. So this is the script a student
// would write: log in, open the quiz, then one act("answer question N correctly") per question, so the model does the
// answering. Login is plain Playwright-style code (no model call), like the Stagehand README's own login example.
//
// stdin: {"loginUrl", "quizTitle", "model": "google/<id>", "headless": true}
// stdout (last line): {"status", "steps", "seconds", "error", "trace"}
// --dry-run: launch, log in and open the quiz with no model client (no LLM calls), to test plumbing.
import { localBrowser, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

const dryRun = process.argv.includes("--dry-run");
const input = JSON.parse(await new Promise((resolve) => {
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => resolve(s));
}));

const t0 = Date.now();
const trace = [];
let steps = 0; // model-backed calls (act / extract)
const log = (kind, detail) => trace.push({ kind, t: (Date.now() - t0) / 1000, ...detail });
const done = (status, error = null) => {
  process.stdout.write("\n" + JSON.stringify({ status, steps, seconds: (Date.now() - t0) / 1000, error, trace }) + "\n");
};

// Poll until the selector matches (this Page API has no waitForLoadState).
async function waitFor(page, selector, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await page.locator(selector).count().catch(() => 0)) > 0) return page.locator(selector);
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for ${selector}`);
}

let browser, stagehand;
try {
  browser = await localBrowser.launch({ headless: input.headless !== false });
  // The browser context only exists once Stagehand is attached. In --dry-run there is no model, so no LLM calls.
  stagehand = await Stagehand.create(dryRun ? { browser } : {
    browser,
    model: { modelName: input.model, apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY },
  });
  const [page] = await browser.context.pages();

  await page.goto(input.loginUrl);
  log("goto", { url: input.loginUrl });
  await (await waitFor(page, 'input[name="username"]')).fill("student1");
  await page.locator('input[type="password"]').fill("sandbox");
  await page.locator('button[type="submit"]').click();
  log("login", {});

  if (dryRun) {
    await (await waitFor(page, `xpath=//a[contains(normalize-space(.), ${JSON.stringify(input.quizTitle)})]`)).click();
    await waitFor(page, ".question");
    const n = await page.locator(".question").count();
    log("dry-run", { questions: n });
    done(n > 0 ? "completed" : "error", n > 0 ? null : "no questions found");
  } else {
    const act = async (instruction) => {
      steps++;
      const r = await stagehand.act(instruction);
      log("act", { instruction, result: JSON.stringify(r).slice(0, 400) });
      return r;
    };

    await act(`click the link to the quiz titled "${input.quizTitle}"`);
    await waitFor(page, ".question");
    steps++;
    const { data } = await stagehand.extract(
      "How many numbered questions are on this quiz page?",
      z.object({ count: z.number().int() }),
    );
    log("extract", { count: data.count });
    for (let i = 1; i <= Math.min(data.count, 50); i++) {
      await act(`Answer Question ${i} correctly: select the correct option, or type the correct answer into its text box`);
    }
    await act('click the "Submit quiz" button');
    done("completed");
  }
} catch (e) {
  done("error", String(e?.stack ?? e).slice(0, 800));
} finally {
  await stagehand?.close().catch(() => {});
  await browser?.close().catch(() => {});
}
