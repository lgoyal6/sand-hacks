// Re-screenshot existing findings (no new searches): the best match per item in data/fixtures/leaks.json
// and in the newest kill-test result. Writes screenshotUrl back, and records why a page was skipped.
//   pnpm --filter @unprompted/leakscan rescreen --captcha-off-at-zone
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LeakFinding } from "@unprompted/shared";
import { brightDataFromEnv, screenshot } from "./brightdata";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const SCREENS = resolve(ROOT, "data/leak-screens");

type Shot = { ok: true } | { ok: false; reason: string };

async function shoot(wss: string, findings: LeakFinding[], cache: Map<string, Shot>, captchaOffAtZone: boolean) {
  const best = new Map<string, LeakFinding>();
  for (const f of [...findings].sort((a, b) => b.matchScore - a.matchScore)) if (!best.has(f.itemId)) best.set(f.itemId, f);
  for (const f of best.values()) {
    let r = cache.get(f.url);
    if (!r) {
      try {
        r = await screenshot(wss, f.url, resolve(SCREENS, `${f.id}.png`), { captchaOffAtZone });
      } catch (e) {
        r = { ok: false, reason: `error: ${(e as Error).message.split("\n")[0].slice(0, 120)}` };
      }
      cache.set(f.url, r);
    }
    if (r.ok) f.screenshotUrl = `/professor/screens/${f.id}.png`;
    console.log(`${f.itemId} ${r.ok ? "screenshot" : r.reason} ${f.url}`);
  }
}

async function main() {
  const cfg = brightDataFromEnv();
  if (!cfg?.browserWss) {
    console.error("Missing BRIGHTDATA_BROWSER_WSS (or customer/zone/password). Nothing done.");
    process.exit(2);
  }
  const captchaOffAtZone = process.argv.includes("--captcha-off-at-zone");
  await mkdir(SCREENS, { recursive: true });
  const cache = new Map<string, Shot>();

  const leaksPath = resolve(ROOT, "data/fixtures/leaks.json");
  const leaks: LeakFinding[] = JSON.parse(await readFile(leaksPath, "utf8"));
  await shoot(cfg.browserWss, leaks, cache, captchaOffAtZone);
  await writeFile(leaksPath, JSON.stringify(leaks, null, 2) + "\n");

  const resultsDir = resolve(HERE, "../results");
  const newest = (await readdir(resultsDir)).filter((f) => f.startsWith("killtest-")).sort().pop();
  if (newest) {
    const p = resolve(resultsDir, newest);
    const kt = JSON.parse(await readFile(p, "utf8"));
    const all: LeakFinding[] = kt.scans.flatMap((s: { findings: LeakFinding[] }) => s.findings);
    await shoot(cfg.browserWss, all, cache, captchaOffAtZone);
    kt.screenshots = [...cache.entries()].map(([url, r]) => ({ url, ok: r.ok, reason: r.ok ? undefined : r.reason }));
    await writeFile(p, JSON.stringify(kt, null, 2));
  }
  const ok = [...cache.values()].filter((r) => r.ok).length;
  console.log(`screenshots: ${ok} of ${cache.size} pages`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
