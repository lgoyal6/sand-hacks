// LLM-free smoke suite for apps/web (owner: A). Uses the shared dev server on :3100 (C runs it); never starts one.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  workers: 1, // 8 GB machine; one browser at a time
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    channel: "chrome", // the installed Google Chrome, no Playwright browser download; temporary profile
    launchOptions: { args: ["--use-mock-keychain", "--password-store=basic"] }, // never touch the macOS Keychain
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "../../traces/e2e", // gitignored
});
