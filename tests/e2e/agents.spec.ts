// Agents panel smoke tests. ZERO LLM calls: the studio replays a recorded run (time-compressed SSE), and the
// event bridge is exercised with a synthetic window event.
import { signIn } from "./auth";
import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } }); // the panel is hidden below the lg breakpoint

test("studio: replaying a recorded run shows agent activity in the Agents panel", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "professor");
  await page.goto("/studio");
  const panel = page.getByRole("complementary", { name: "Agents" });
  await expect(panel).toBeVisible();
  const before = await panel.innerText();

  const stream = page.waitForResponse((r) => r.url().includes("/studio/api/run") && r.url().includes("mode=replay"));
  await page.locator("#studio-composer").fill("replay the recorded run");
  await page.locator("#studio-send").click();
  expect((await stream).status()).toBe(200);

  await expect.poll(() => panel.innerText(), { timeout: 30_000, message: "Agents panel never changed during replay" }).not.toBe(before);
  expect(errors).toEqual([]);
});

test("agent-status window events render in the Agents panel", async ({ page }) => {
  await signIn(page, "professor");
  await page.goto("/studio");
  const panel = page.getByRole("complementary", { name: "Agents" });
  await expect(panel).toBeVisible();
  const status = `E2E check ${Date.now()}`;
  await page.evaluate((s) => {
    window.dispatchEvent(new CustomEvent("unprompted:agent-status", {
      detail: { agent: "quiz-checker", status: s, state: "working", at: new Date().toISOString() },
    }));
  }, status);
  await expect(panel).toContainText(status);
});

test.fixme("researcher answer shows cited sources (waiting for the Researcher agent to land on dev)", async () => {});
