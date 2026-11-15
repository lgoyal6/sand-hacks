// SCRIPTED (not AI) agent-like sessions against C's runtime, for D's detection model as EXTRA TRAINING DATA ONLY.
// They mirror the two input styles real browser-use runs showed in the sandbox. They are not agent runs, are labelled
// as scripted, and must never be used as the evaluation set (real agent runs are). No LLM calls anywhere:
//   cdp    : trusted clicks via raw CDP Input.dispatchMouseEvent press/release with NO mouse move first, text via
//            Input.insertText (no key events), evenly spaced actions.
//   jsfill : untrusted element.click() and the native value setter + one synthetic input event (what an agent running
//            JS in the page does on a React app), no pointer or key events, near-instant.
// Practice mode, and any probe is skipped at its intro: in graded mode the probe's follow-up calls Gemini server-side.
//
// Labels: test-scripted-<style>-<n> (the demo account only honours agent-/e2e-/test- prefixes; checked per session).
// usage: node scripted/drive.mjs --style cdp|jsfill --count 10 [--base http://localhost:3100] [--headed]
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const STYLE = arg("style");
const COUNT = Number(arg("count", "10"));
const BASE = arg("base", "http://localhost:3100");
const QUIZ = "sample-stats";
const TOKEN = process.env.SANDBOX_RUNNER_TOKEN ?? "dev-runner-token";
// C's runtime only lets the demo account tag attempts with agent-/e2e-/test- prefixes; anything else silently falls
// back to the demo student's own pseudonym, which would pass scripted sessions off as a student.
const PREFIX = "test-scripted";
if (!["cdp", "jsfill"].includes(STYLE)) throw new Error("--style cdp|jsfill");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("local runtime only");

// Answer keys for OUR sample quiz. ~15% of items get a wrong answer so sessions aren't all perfect.
const quiz = JSON.parse(readFileSync(new URL("../../../apps/sandbox/quizzes/sample-stats.json", import.meta.url)));
const answerFor = (item, rng) => {
  const wrong = rng() < 0.15;
  if (item.type === "numeric") return { text: wrong ? "1/12" : String(item.answerKey) };
  const ids = item.choices.map((c) => c.id);
  return { choice: wrong ? ids.find((x) => x !== item.answerKey) : item.answerKey };
};
// Deterministic per session, so a rerun of the same label reproduces it.
const mulberry = (a) => () => ((a = (a + 0x6d2b79f5) | 0), (((a ^ (a >>> 15)) * (1 | a)) >>> 0) / 4294967296);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function nextFreeIndex() {
  for (let n = 1; ; n++) {
    const r = await fetch(`${BASE}/api/attempts?student=${PREFIX}-${STYLE}-${n}`, { headers: { "x-runner-token": TOKEN } });
    if (!r.ok) throw new Error(`runner API ${r.status}`);
    if ((await r.json()).attempts.length === 0) return n;
  }
}

async function waitVisible(page, sel, ms = 20000) {
  // sr-only inputs count as "attached" rather than visible
  await page.locator(sel).first().waitFor({ state: /#choice-[a-z]$/.test(sel) ? "attached" : "visible", timeout: ms });
  return page.locator(sel).first();
}

// ---- input styles ----
function cdpStyle(page, cdp) {
  return {
    async click(sel) {
      const el = await waitVisible(page, sel);
      const box = await el.boundingBox();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      // press + release only: no mouseMoved, which is exactly the tell C's telemetry saw on real CDP agents
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      await sleep(700); // evenly spaced actions
    },
    async type(sel, text) {
      await this.click(sel);
      await cdp.send("Input.insertText", { text });
      await sleep(700);
    },
  };
}

function jsStyle(page) {
  return {
    async click(sel) {
      await waitVisible(page, sel);
      await page.evaluate((s) => document.querySelector(s).click(), sel);
      await sleep(60);
    },
    async type(sel, text) {
      await waitVisible(page, sel);
      await page.evaluate(([s, v]) => {
        const el = document.querySelector(s);
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
        setter.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }, [sel, text]);
      await sleep(60);
    },
  };
}

// Click `sel` until `expect` shows up (a no-move click can land before React has the selection); max 3 tries.
async function clickUntil(page, io, sel, expect, tries = 3) {
  for (let i = 0; i < tries; i++) {
    await io.click(sel);
    try {
      await page.locator(expect).first().waitFor({ state: "visible", timeout: 8000 });
      return;
    } catch {}
  }
  throw new Error(`no ${expect} after clicking ${sel} ${tries} times`);
}

async function session(browser, label, seed) {
  const rng = mulberry(seed);
  const context = await browser.newContext();
  const page = await context.newPage();
  const io = STYLE === "cdp" ? cdpStyle(page, await context.newCDPSession(page)) : jsStyle(page);
  const t0 = Date.now();
  let probesSkipped = 0;
  try {
    // Neon Auth: pages need a session. Sign-in happens before the attempt exists, so it adds no attempt telemetry.
    await page.goto(`${BASE}/signin`);
    await page.locator("#demo-student").click();
    await page.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 30000 });
    await page.goto(`${BASE}/quiz/${QUIZ}?mode=practice&student=${label}`);
    await io.click("#start-practice");
    for (const [i, item] of quiz.items.entries()) {
      await waitVisible(page, `#item-${item.id}`);
      const a = answerFor(item, rng);
      // Radios are visually hidden: cdp clicks the visible label (trusted), jsfill clicks the input itself (untrusted).
      if (a.choice) await io.click(STYLE === "cdp" ? `#item-${item.id} label:has(#choice-${a.choice})` : `#item-${item.id} #choice-${a.choice}`);
      else await io.type("#answer-input", a.text);
      await clickUntil(page, io, "#submit-answer", "#probe, #item-feedback");
      if (await page.locator("#probe-skip").isVisible().catch(() => false)) {
        await io.click("#probe-skip");
        probesSkipped++;
      }
      const last = i === quiz.items.length - 1;
      await clickUntil(page, io, last ? "#finish-quiz" : "#next-item", last ? "#quiz-done" : `#item-${quiz.items[i + 1].id}`);
    }
    await waitVisible(page, "#quiz-done");
    await sleep(1500); // let the telemetry batch flush
    return { label, style: STYLE, ok: true, seconds: (Date.now() - t0) / 1000, probesSkipped };
  } catch (e) {
    return { label, style: STYLE, ok: false, seconds: (Date.now() - t0) / 1000, error: String(e.message ?? e).slice(0, 300) };
  } finally {
    await context.close();
  }
}

// Temporary profile (Playwright default) and no Keychain access.
const browser = await chromium.launch({ channel: "chrome", headless: !process.argv.includes("--headed"),
  args: ["--use-mock-keychain", "--password-store=basic"] });
const start = await nextFreeIndex();
const results = [];
for (let n = start; n < start + COUNT; n++) {
  const label = `${PREFIX}-${STYLE}-${n}`;
  const r = await session(browser, label, n * 7919 + (STYLE === "cdp" ? 1 : 2));
  // Verify the label really landed on the attempt; stop the batch if it didn't.
  const check = await fetch(`${BASE}/api/attempts?student=${label}`, { headers: { "x-runner-token": TOKEN } }).then((x) => x.json());
  r.labelStored = (check.attempts ?? []).length > 0;
  console.log(JSON.stringify(r));
  results.push(r);
  if (!r.labelStored) {
    console.error(`ABORT: attempt for ${label} was not stored under that label (pseudonym rule?)`);
    break;
  }
}
await browser.close();
console.log(`${results.filter((r) => r.ok).length}/${results.length} ${STYLE} sessions completed`);
