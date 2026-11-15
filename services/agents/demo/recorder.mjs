// Frame recorder for the demo video: attaches to a Chrome over CDP (the same browser browser-use is driving) and
// screenshots whichever page is newest, about 5 times a second, until SIGTERM. Frames are named by elapsed ms so the
// encoder can keep real timing.  usage: node demo/recorder.mjs <cdpHttpUrl> <framesDir>
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const [cdp, dir] = process.argv.slice(2);
mkdirSync(dir, { recursive: true });
const browser = await chromium.connectOverCDP(cdp);
const t0 = Date.now();
let stop = false;
process.on("SIGTERM", () => (stop = true));
process.on("SIGINT", () => (stop = true));

let n = 0;
while (!stop) {
  const pages = browser.contexts().flatMap((c) => c.pages()).filter((p) => !p.isClosed() && p.url().startsWith("http"));
  const page = pages.at(-1);
  if (page) {
    try {
      const buf = await page.screenshot({ type: "jpeg", quality: 80, timeout: 2000 });
      writeFileSync(path.join(dir, `${String(Date.now() - t0).padStart(8, "0")}.jpg`), buf);
      n++;
    } catch {
      // page navigating; skip this tick
    }
  }
  await new Promise((r) => setTimeout(r, 200));
}
console.log(JSON.stringify({ frames: n, seconds: (Date.now() - t0) / 1000 }));
await browser.close().catch(() => {});
process.exit(0);
