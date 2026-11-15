// Neon Auth demo sign-in (C, dev 470130a): every page needs a session; APIs stay open.
import { expect, type Page } from "@playwright/test";

export async function signIn(page: Page, role: "student" | "professor") {
  await page.goto("/signin");
  // The button can render before hydration (the server action is then a no-op), and the first action on a cold dev
  // server is slow: retry the click until we leave /signin.
  await expect(async () => {
    // C's action redirects to /signin?error=... on failure: report that instead of retrying.
    const err = new URL(page.url()).searchParams.get("error");
    const alert = await page.locator("[role=alert]").first().textContent({ timeout: 500 }).catch(() => null);
    if (err || alert) throw new Error(`demo sign-in failed: ${err ?? ""} ${alert ?? ""}`.trim());
    if (/\/signin/.test(page.url())) await page.locator(`#demo-${role}`).click({ timeout: 5_000 });
    await expect(page).not.toHaveURL(/\/signin/, { timeout: 15_000 });
  }).toPass({ timeout: 90_000 });
}
