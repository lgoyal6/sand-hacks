// Neon Auth demo sign-in (C, dev 470130a): every page needs a session; APIs stay open.
import { expect, type Page } from "@playwright/test";

export async function signIn(page: Page, role: "student" | "professor") {
  await page.goto("/signin");
  await page.locator(`#demo-${role}`).click();
  await expect(page).not.toHaveURL(/\/signin/, { timeout: 30_000 });
}
